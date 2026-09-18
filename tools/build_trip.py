"""Maakt data/trip.json uit tools/plan.json: coordinaten, rij-afstanden en de inhoud uit tools/content/.

Gebruik:  python tools/build_trip.py      daarna: python tools/encrypt_trip.py
plan.json, content/ en trip.json staan in .gitignore; alleen het versleutelde data/trip.enc gaat de repo in.
Opgezochte coordinaten en routes worden bewaard in tools/content/_cache.json, zodat opnieuw bouwen zonder internet kan.
"""
import io, json, os, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAN = os.path.join(ROOT, 'tools', 'plan.json')
CONTENT = os.path.join(ROOT, 'tools', 'content')
CACHE = os.path.join(CONTENT, '_cache.json')
OUT = os.path.join(ROOT, 'data', 'trip.json')
UA = {'User-Agent': 'reisplanner-prive/1.0'}

cache = json.load(io.open(CACHE, encoding='utf-8')) if os.path.exists(CACHE) else {}


def write_json(path, obj, **kw):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with io.open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(obj, f, ensure_ascii=False, **kw)
    os.replace(tmp, path)


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))


def geocode(p):
    if 'lat' in p and 'lng' in p:
        return p['lat'], p['lng']
    q = p.get('query') or p['name']
    if 'geo:' + q not in cache:
        hits = get('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + urllib.parse.quote(q))
        time.sleep(1.1)
        if not hits:
            sys.exit('Niet gevonden: ' + p['name'])
        cache['geo:' + q] = [round(float(hits[0]['lat']), 4), round(float(hits[0]['lon']), 4)]
    return tuple(cache['geo:' + q])


def route(a, b):
    k = 'route:%s,%s>%s,%s' % (a[0], a[1], b[0], b[1])
    if k not in cache:
        j = get('https://router.project-osrm.org/route/v1/driving/%f,%f;%f,%f?overview=false' % (a[1], a[0], b[1], b[0]))
        time.sleep(1.1)
        rt = j['routes'][0]
        cache[k] = [round(rt['distance'] / 1000, 1), round(rt['duration'] / 60)]
    return tuple(cache[k])


def content(key):
    path = os.path.join(CONTENT, key + '.json')
    if not os.path.exists(path):
        return None
    about = json.load(io.open(path, encoding='utf-8-sig'))
    about.pop('sources', None)
    return about


def main():
    plan = json.load(io.open(PLAN, encoding='utf-8'))
    stays = []
    for i, s in enumerate(plan['stays']):
        lat, lng = geocode(s)
        sid = 's%d' % (i + 1)
        stay = {'id': sid, 'name': s['name'], 'lat': lat, 'lng': lng, 'from': s['from'], 'to': s['to'],
                'checkin': s.get('checkin', ''), 'checkout': s.get('checkout', ''), 'kind': s.get('kind', ''),
                'scene': s.get('scene', ''), 'sea': bool(s.get('sea'))}
        about = content(sid)
        if about:
            stay['about'] = about
        stays.append(stay)
        print('plek', s['name'], lat, lng, '| inhoud:', 'ja' if about else 'nee')

    ends = {}
    for k in ('arrive', 'depart'):
        if plan.get(k):
            lat, lng = geocode(plan[k])
            ends[k] = {'name': plan[k]['name'], 'lat': lat, 'lng': lng}

    hops = []
    if 'arrive' in ends:
        hops.append((plan['start'], ends['arrive'], stays[0]))
    for a, b in zip(stays, stays[1:]):
        hops.append((a['to'], a, b))
    if 'depart' in ends:
        hops.append((plan['end'], stays[-1], ends['depart']))
    legs = []
    for date, a, b in hops:
        km, mins = route((a['lat'], a['lng']), (b['lat'], b['lng']))
        legs.append({'date': date, 'fromName': a['name'], 'toName': b['name'], 'to': [b['lat'], b['lng']], 'km': km, 'min': mins})
        print('rit', a['name'], '->', b['name'], km, 'km', mins, 'min')

    trip = {'title': plan['title'], 'start': plan['start'], 'end': plan['end'], 'stays': stays, 'legs': legs,
            'flights': plan.get('flights', [])}
    country = content('country')
    if country:
        trip['country'] = country
    info = content('info')
    if info:
        trip['info'] = info
    print('land-inhoud:', 'ja' if country else 'nee', '| praktische info:', 'ja' if info else 'nee')
    write_json(CACHE, cache, indent=1)
    write_json(OUT, trip, separators=(',', ':'))
    print('geschreven:', OUT, os.path.getsize(OUT) // 1024, 'kB')


if __name__ == '__main__':
    main()
