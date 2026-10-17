import sys, json

for cat in json.load(sys.stdin):
    print('  ' + cat['nombre'].upper())
    for p in cat['productos']:
        bs = p['precioCentavos'] // 100
        if p['variantes']:
            print('    ' + p['nombre'])
            for v in p['variantes']:
                print('        {:<12} Bs {}'.format(v['nombre'], v['precioCentavos'] // 100))
        else:
            print('    {:<28} Bs {}'.format(p['nombre'], bs))
    print()
