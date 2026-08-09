#!/usr/bin/env python3
"""
Cleanup script for SO/PO test records
"""
import sqlite3
import sys

DB_PATH = "/app/data/erp.db"

def cleanup_orders(so_ids, po_ids):
    """Hard delete orders from SQLite DB"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Delete sales orders
        for so_id in so_ids:
            # Delete items first (foreign key)
            cursor.execute("DELETE FROM sales_order_items WHERE sales_order_id = ?", (so_id,))
            deleted_items = cursor.rowcount
            
            # Delete order
            cursor.execute("DELETE FROM sales_order WHERE id = ?", (so_id,))
            deleted_order = cursor.rowcount
            
            print(f"✅ Deleted SO {so_id}: {deleted_items} items, {deleted_order} order")
        
        # Delete purchase orders
        for po_id in po_ids:
            # Delete items first (foreign key)
            cursor.execute("DELETE FROM purchase_order_items WHERE purchase_order_id = ?", (po_id,))
            deleted_items = cursor.rowcount
            
            # Delete order
            cursor.execute("DELETE FROM purchase_order WHERE id = ?", (po_id,))
            deleted_order = cursor.rowcount
            
            print(f"✅ Deleted PO {po_id}: {deleted_items} items, {deleted_order} order")
        
        conn.commit()
        conn.close()
        
        print("✅ Cleanup completed successfully")
        return True
        
    except Exception as e:
        print(f"❌ Cleanup exception: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: cleanup_orders.py SO_ID1 [SO_ID2] [PO_ID1] ...")
        sys.exit(1)
    
    # Assume first 2 args are SO IDs, rest are PO IDs
    so_ids = sys.argv[1:3] if len(sys.argv) >= 3 else [sys.argv[1]]
    po_ids = sys.argv[3:] if len(sys.argv) > 3 else []
    
    cleanup_orders(so_ids, po_ids)
