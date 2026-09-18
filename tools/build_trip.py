"""Maakt data/trip.json uit tools/plan.json: zoekt coordinaten op en rekent de wegroutes uit.

Gebruik:  python tools/build_trip.py
Beide bestanden staan in .gitignore; alleen het versleutelde data/trip.enc gaat de repo in.
"""
import io, json, math, os, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAN = os.path.join(ROOT, 'tools', 'plan.json')
OUT = os.path.join(ROOT, 'data', 'trip.json')
UA = {'User-Agent': 'reisplanner-prive/1.0'}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))


def geocode(p):
    if 'lat' in p and 'lng' in p:
        return p['lat'], p['lng']
    hits = get('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + urllib.parse.quote(p.get('query') or p['name']))
    time.sleep(1.1)
    if not hits:
        sys.exit('Niet gevonden: ' + p['name'])
    return round(float(hits[0]['lat']), 4), round(float(hits[0]['lon']), 4)


def dist_m(a, b):
    r = math.pi / 180
    x = (b[1] - a[1]) * r * math.cos((a[0] + b[0]) / 2 * r)
    y = (b[0] - a[0]) * r
    return 6371000 * math.hypot(x, y)


def route(a, b):
    j = get('https://router.project-osrm.org/route/v1/driving/%f,%f;%f,%f?overview=full&geometries=geojson' % (a[1], a[0], b[1], b[0]))
    time.sleep(1.1)
    rt = j['routes'][0]
    pts = [[round(c[1], 5), round(c[0], 5)] for c in rt['geometry']['coordinates']]
    thin = [pts[0]]
    for p in pts[1:-1]:
        if dist_m(thin[-1], p) > 40:
            thin.append(p)
    thin.append(pts[-1])
    return round(rt['distance'] / 1000, 1), round(rt['duration'] / 60), thin


def main():
    plan = json.load(io.open(PLAN, encoding='utf-8'))
    stays, points = [], []
    for i, s in enumerate(plan['stays']):
        lat, lng = geocode(s)
        stays.append({'id': 's%d' % (i + 1), 'name': s['name'], 'lat': lat, 'lng': lng, 'from': s['from'], 'to': s['to'],
                      'checkin': s.get('checkin', ''), 'checkout': s.get('checkout', ''), 'note': s.get('note', ''), 'scene': s.get('scene', '')})
        print('plek', s['name'], lat, lng)
    ends = {}
    for k in ('arrive', 'depart'):
        if plan.get(k):
            lat, lng = geocode(plan[k])
            ends[k] = {'name': plan[k]['name'], 'lat': lat, 'lng': lng}
            if not any(p['name'] == plan[k]['name'] for p in points):
                points.append(ends[k])

    hops = []
    if 'arrive' in ends:
        hops.append((plan['start'], ends['arrive'], stays[0]))
    for a, b in zip(stays, stays[1:]):
        hops.append((a['to'], a, b))
    if 'depart' in ends:
        hops.append((plan['end'], stays[-1], ends['depart']))
    legs = []
    for date, a, b in hops:
        km, mins, geo = route((a['lat'], a['lng']), (b['lat'], b['lng']))
        legs.append({'date': date, 'fromName': a['name'], 'toName': b['name'], 'to': [b['lat'], b['lng']], 'km': km, 'min': mins})
        print('rit', a['name'], '->', b['name'], km, 'km', mins, 'min', len(geo), 'punten')

    trip = {'title': plan['title'], 'start': plan['start'], 'end': plan['end'], 'stays': stays, 'points': points,
            'legs': legs, 'flights': plan.get('flights', []), 'dayNotes': plan.get('dayNotes', {})}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + '.tmp'
    with io.open(tmp, 'w', encoding='utf-8') as f:
        json.dump(trip, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, OUT)
    print('geschreven:', OUT, os.path.getsize(OUT) // 1024, 'kB')


if __name__ == '__main__':
    main()
