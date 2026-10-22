"""Independent reader validation: python scripts/audit-dxf.py output.dxf"""
import sys
import ezdxf
from ezdxf.entities.acad_table import read_acad_table_content

doc=ezdxf.readfile(sys.argv[1])
audit=doc.audit()
assert not audit.errors, audit.errors
assert not audit.fixes, audit.fixes
tables=list(doc.modelspace().query('ACAD_TABLE'))
assert tables, 'No native AutoCAD tables found'
assert len(tables)==len(doc.modelspace()), 'Unexpected modelspace entities'
for table in tables:
    cells=read_acad_table_content(table)
    assert cells and all(len(row)==4 for row in cells)
print(f'{len(tables)} native tables; no audit errors or repairs.')
