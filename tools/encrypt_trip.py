"""Versleutelt data/trip.json naar data/trip.enc (AES-256-GCM, sleutel via PBKDF2-SHA256).

Zelfde formaat als de app (WebCrypto): {"v":1,"salt","iv","ct"} met ct = cijfertekst + tag, alles base64.
Zuiver Python, geen extra pakketten nodig.

Gebruik:
  python tools/encrypt_trip.py            vraagt het wachtwoord (of leest REIS_WACHTWOORD)
  python tools/encrypt_trip.py --check    ontsleutelt het bestaande trip.enc en toont de titel
  python tools/encrypt_trip.py --new-salt nieuw wachtwoord: iedereen moet opnieuw ontgrendelen

Zonder --new-salt blijft de salt gelijk, zodat toestellen die al ontgrendeld zijn dat blijven.
"""
import base64, getpass, hashlib, io, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'trip.json')
OUT = os.path.join(ROOT, 'data', 'trip.enc')
ITERATIONS = 250000


# ---------- AES-256 (alleen versleutelen; GCM heeft niets anders nodig) ----------
def _rotl8(x, s):
    return ((x << s) | (x >> (8 - s))) & 0xff


def _make_sbox():
    sbox = [0] * 256
    p = q = 1
    while True:
        p = (p ^ (p << 1) ^ (0x1b if p & 0x80 else 0)) & 0xff
        q ^= q << 1
        q ^= q << 2
        q ^= q << 4
        q &= 0xff
        if q & 0x80:
            q ^= 0x09
        sbox[p] = (q ^ _rotl8(q, 1) ^ _rotl8(q, 2) ^ _rotl8(q, 3) ^ _rotl8(q, 4) ^ 0x63) & 0xff
        if p == 1:
            break
    sbox[0] = 0x63
    return sbox


SBOX = _make_sbox()


def _xtime(a):
    return ((a << 1) ^ 0x1b) & 0xff if a & 0x80 else a << 1


def _expand_key(key):
    assert len(key) == 32
    words = [list(key[i:i + 4]) for i in range(0, 32, 4)]
    rcon = 1
    for i in range(8, 60):
        t = list(words[i - 1])
        if i % 8 == 0:
            t = t[1:] + t[:1]
            t = [SBOX[b] for b in t]
            t[0] ^= rcon
            rcon = _xtime(rcon)
        elif i % 8 == 4:
            t = [SBOX[b] for b in t]
        words.append([a ^ b for a, b in zip(words[i - 8], t)])
    return [sum(words[r * 4:r * 4 + 4], []) for r in range(15)]


def _encrypt_block(round_keys, block):
    s = [b ^ k for b, k in zip(block, round_keys[0])]
    for rnd in range(1, 15):
        s = [SBOX[b] for b in s]
        s = [s[((c + r) % 4) * 4 + r] for c in range(4) for r in range(4)]
        if rnd != 14:
            m = []
            for c in range(4):
                a = s[c * 4:c * 4 + 4]
                x = a[0] ^ a[1] ^ a[2] ^ a[3]
                m += [a[i] ^ x ^ _xtime(a[i] ^ a[(i + 1) % 4]) for i in range(4)]
            s = m
        s = [b ^ k for b, k in zip(s, round_keys[rnd])]
    return bytes(s)


# ---------- GCM ----------
_R = 0xE1 << 120


def _gf_mul(x, y):
    z, v = 0, x
    for i in range(127, -1, -1):
        if (y >> i) & 1:
            z ^= v
        v = (v >> 1) ^ (_R if v & 1 else 0)
    return z


def _ghash(h, data):
    y = 0
    for i in range(0, len(data), 16):
        y = _gf_mul(y ^ int.from_bytes(data[i:i + 16].ljust(16, b'\0'), 'big'), h)
    return y


def _ctr(round_keys, iv, data):
    out = bytearray()
    for n, i in enumerate(range(0, len(data), 16)):
        ks = _encrypt_block(round_keys, iv + (n + 2).to_bytes(4, 'big'))
        out += bytes(a ^ b for a, b in zip(data[i:i + 16], ks))
    return bytes(out)


def _tag(round_keys, iv, ct):
    h = int.from_bytes(_encrypt_block(round_keys, bytes(16)), 'big')
    padded = ct + bytes(-len(ct) % 16) + (0).to_bytes(8, 'big') + (len(ct) * 8).to_bytes(8, 'big')
    s = _ghash(h, padded)
    j0 = _encrypt_block(round_keys, iv + b'\0\0\0\1')
    return (s ^ int.from_bytes(j0, 'big')).to_bytes(16, 'big')


def gcm_encrypt(key, iv, plaintext):
    rk = _expand_key(key)
    ct = _ctr(rk, iv, plaintext)
    return ct + _tag(rk, iv, ct)


def gcm_decrypt(key, iv, blob):
    rk = _expand_key(key)
    ct, tag = blob[:-16], blob[-16:]
    if _tag(rk, iv, ct) != tag:
        raise ValueError('onjuist wachtwoord of beschadigd bestand')
    return _ctr(rk, iv, ct)


# ---------- bestand ----------
def derive(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, ITERATIONS, 32)


def password():
    return os.environ.get('REIS_WACHTWOORD') or getpass.getpass('Wachtwoord: ')


def main():
    existing = json.load(io.open(OUT, encoding='utf-8')) if os.path.exists(OUT) else None
    if '--check' in sys.argv:
        key = derive(password(), base64.b64decode(existing['salt']))
        trip = json.loads(gcm_decrypt(key, base64.b64decode(existing['iv']), base64.b64decode(existing['ct'])).decode('utf-8'))
        print('ok:', trip['title'], '|', len(trip['stays']), 'plekken |', len(existing['ct']) * 3 // 4 // 1024, 'kB')
        return
    pw = password()
    if len(pw) < 10:
        sys.exit('Kies een wachtwoord van minimaal 10 tekens.')
    salt = base64.b64decode(existing['salt']) if existing and '--new-salt' not in sys.argv else os.urandom(16)
    if existing and '--new-salt' not in sys.argv:
        # zelfde salt betekent: het moet ook hetzelfde wachtwoord zijn, anders werkt de bewaarde sleutel op toestellen niet meer
        gcm_decrypt(derive(pw, salt), base64.b64decode(existing['iv']), base64.b64decode(existing['ct']))
    key, iv = derive(pw, salt), os.urandom(12)
    plain = json.dumps(json.load(io.open(SRC, encoding='utf-8')), ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    blob = gcm_encrypt(key, iv, plain)
    assert gcm_decrypt(key, iv, blob) == plain
    enc = {'v': 1, 'salt': base64.b64encode(salt).decode(), 'iv': base64.b64encode(iv).decode(), 'ct': base64.b64encode(blob).decode()}
    tmp = OUT + '.tmp'
    with io.open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(enc, f, separators=(',', ':'))
    os.replace(tmp, OUT)
    print('geschreven:', OUT, os.path.getsize(OUT) // 1024, 'kB')


if __name__ == '__main__':
    main()
