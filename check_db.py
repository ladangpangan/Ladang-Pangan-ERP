import sqlite3

conn = sqlite3.connect('/app/data/erp.db')
cursor = conn.cursor()

# Check commission_records table
cursor.execute("SELECT * FROM commission_records")
records = cursor.fetchall()

print(f"Commission Records: {len(records)}")
for rec in records:
    print(f"  {rec}")

# Check recent SOs
cursor.execute("SELECT so_number, total_amount FROM sales_order ORDER BY created_at DESC LIMIT 10")
sos = cursor.fetchall()
print(f"\nRecent SOs:")
for so in sos:
    print(f"  {so}")

conn.close()
