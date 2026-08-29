#!/usr/bin/env python3
"""
Backend Test: Detailed SO & PO Audit with 'used' stock investigation
"""

import requests
import json

BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

session = requests.Session()

def login():
    response = session.post(
        f"{BASE_URL}/auth/sign-in/email",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )
    return response.status_code == 200

def investigate_used_stocks():
    """Investigate the 19 'used' stocks to see which SOs they belong to."""
    print("\n" + "="*80)
    print("INVESTIGATING 'USED' STOCKS")
    print("="*80)
    
    # Get all stocks
    response = session.get(f"{BASE_URL}/inventory/stocks")
    stocks = response.json()
    if isinstance(stocks, dict):
        stocks = stocks.get("data", [])
    
    used_stocks = [s for s in stocks if s.get("status") == "used"]
    print(f"\nFound {len(used_stocks)} 'used' stocks")
    
    # Get all SOs with details
    so_response = session.get(f"{BASE_URL}/sales-orders")
    sales_orders = so_response.json()
    if isinstance(sales_orders, dict):
        sales_orders = sales_orders.get("data", [])
    
    print(f"Found {len(sales_orders)} sales orders")
    
    # Build a map of stock allocations from SOs
    stock_to_so = {}
    
    for so in sales_orders:
        so_id = so.get("id")
        so_number = so.get("soNumber") or so.get("so_number")
        status = so.get("status")
        archived = so.get("archived", False)
        
        # Get SO details to see items and allocations
        detail_response = session.get(f"{BASE_URL}/sales-orders/{so_id}")
        if detail_response.status_code == 200:
            so_detail = detail_response.json()
            items = so_detail.get("items", [])
            
            for item in items:
                # Check for stock allocations
                stock_codes = item.get("soItemStocks", []) or item.get("so_item_stocks", [])
                
                for stock_alloc in stock_codes:
                    stock_id = stock_alloc.get("stockId") or stock_alloc.get("stock_id")
                    kode = stock_alloc.get("kodeSimpan") or stock_alloc.get("kode_simpan")
                    
                    if stock_id or kode:
                        key = stock_id or kode
                        stock_to_so[key] = {
                            "so_number": so_number,
                            "so_id": so_id,
                            "status": status,
                            "archived": archived
                        }
    
    print(f"\nBuilt allocation map for {len(stock_to_so)} stocks")
    
    # Check each 'used' stock
    print("\n📊 'USED' STOCK DETAILS:")
    
    stranded_count = 0
    valid_count = 0
    
    for stock in used_stocks[:10]:  # Show first 10
        stock_id = stock.get("id")
        kode = stock.get("kodeSimpan") or stock.get("kode_simpan") or stock.get("kode")
        weight = stock.get("weight", 0)
        
        # Check if we can find the SO
        so_info = stock_to_so.get(stock_id) or stock_to_so.get(kode)
        
        if so_info:
            so_status = so_info.get("status")
            archived = so_info.get("archived", False)
            
            if so_status in ["Cancelled", "Dibatalkan"] or archived:
                print(f"   ❌ {kode}: {weight} kg → SO {so_info['so_number']} (status={so_status}, archived={archived}) [STRANDED]")
                stranded_count += 1
            else:
                print(f"   ✅ {kode}: {weight} kg → SO {so_info['so_number']} (status={so_status}) [VALID]")
                valid_count += 1
        else:
            print(f"   ⚠️  {kode}: {weight} kg → No SO found [UNKNOWN]")
    
    if len(used_stocks) > 10:
        print(f"   ... and {len(used_stocks) - 10} more")
    
    print(f"\n📊 SUMMARY:")
    print(f"   Total 'used' stocks: {len(used_stocks)}")
    print(f"   Valid (tied to active SO): {valid_count}")
    print(f"   Stranded (tied to cancelled/archived SO): {stranded_count}")
    print(f"   Unknown (no SO found): {len(used_stocks) - valid_count - stranded_count}")

def check_so_details():
    """Check specific SO details."""
    print("\n" + "="*80)
    print("CHECKING SPECIFIC SO DETAILS")
    print("="*80)
    
    # Get all SOs
    response = session.get(f"{BASE_URL}/sales-orders")
    sales_orders = response.json()
    if isinstance(sales_orders, dict):
        sales_orders = sales_orders.get("data", [])
    
    # Find SO/202608/0002 and SO/202608/0014
    target_sos = ["SO/202608/0002", "SO/202608/0014"]
    
    for target in target_sos:
        found = False
        for so in sales_orders:
            so_number = so.get("soNumber") or so.get("so_number")
            if so_number == target:
                found = True
                so_id = so.get("id")
                
                print(f"\n📄 {target}:")
                print(f"   ID: {so_id}")
                print(f"   Status: {so.get('status')}")
                print(f"   Archived: {so.get('archived', False)}")
                
                # Get details
                detail_response = session.get(f"{BASE_URL}/sales-orders/{so_id}")
                if detail_response.status_code == 200:
                    detail = detail_response.json()
                    print(f"   ✅ Details fetched successfully")
                    
                    items = detail.get("items", [])
                    print(f"   Items: {len(items)}")
                    
                    for i, item in enumerate(items):
                        print(f"      Item {i+1}:")
                        print(f"         Product: {item.get('product', {}).get('name', 'N/A')}")
                        print(f"         Quantity: {item.get('quantity', 0)}")
                        
                        stock_codes = item.get("soItemStocks", []) or item.get("so_item_stocks", [])
                        print(f"         Allocated stocks: {len(stock_codes)}")
                        
                        for stock in stock_codes:
                            kode = stock.get("kodeSimpan") or stock.get("kode_simpan")
                            print(f"            - {kode}")
                else:
                    print(f"   ❌ Failed to fetch details: {detail_response.status_code}")
                
                break
        
        if not found:
            print(f"\n⚠️  {target}: Not found in sales orders list")

def check_accounting_with_akuntan():
    """Try accounting endpoints with akuntan role."""
    print("\n" + "="*80)
    print("CHECKING ACCOUNTING (with akuntan credentials)")
    print("="*80)
    
    # Login as akuntan
    akuntan_session = requests.Session()
    response = akuntan_session.post(
        f"{BASE_URL}/auth/sign-in/email",
        json={"email": "akuntan@lpi.co.id", "password": "akuntanlpi123"}
    )
    
    if response.status_code != 200:
        print(f"❌ Akuntan login failed: {response.status_code}")
        return
    
    print(f"✅ Akuntan login successful")
    
    # Balance sheet
    bs_response = akuntan_session.get(f"{BASE_URL}/accounting/balance-sheet")
    if bs_response.status_code == 200:
        bs_data = bs_response.json()
        balanced = bs_data.get("balanced", False)
        assets = bs_data.get("totalAssets", 0)
        liabilities = bs_data.get("totalLiabilities", 0)
        equity = bs_data.get("totalEquity", 0)
        
        print(f"\n📊 Balance Sheet:")
        print(f"   Balanced: {balanced}")
        print(f"   Total Assets: Rp {assets:,.2f}")
        print(f"   Total Liabilities: Rp {liabilities:,.2f}")
        print(f"   Total Equity: Rp {equity:,.2f}")
        print(f"   L + E: Rp {liabilities + equity:,.2f}")
        print(f"   Difference: Rp {abs(assets - (liabilities + equity)):,.2f}")
        
        if balanced:
            print(f"   ✅ BALANCED")
        else:
            print(f"   ❌ NOT BALANCED")
    else:
        print(f"❌ Balance sheet failed: {bs_response.status_code}")
    
    # Trial balance
    tb_response = akuntan_session.get(f"{BASE_URL}/accounting/trial-balance")
    if tb_response.status_code == 200:
        tb_data = tb_response.json()
        accounts = tb_data if isinstance(tb_data, list) else tb_data.get("accounts", [])
        
        total_debit = sum(acc.get("debit", 0) for acc in accounts)
        total_credit = sum(acc.get("credit", 0) for acc in accounts)
        
        print(f"\n📊 Trial Balance:")
        print(f"   Total Debit: Rp {total_debit:,.2f}")
        print(f"   Total Credit: Rp {total_credit:,.2f}")
        print(f"   Difference: Rp {abs(total_debit - total_credit):,.2f}")
        
        if abs(total_debit - total_credit) < 1.0:
            print(f"   ✅ EQUAL")
        else:
            print(f"   ❌ NOT EQUAL")
    else:
        print(f"❌ Trial balance failed: {tb_response.status_code}")

def main():
    print("\n" + "="*80)
    print("DETAILED SO & PO AUDIT")
    print("="*80)
    
    if not login():
        print("❌ Login failed")
        return
    
    print("✅ Login successful")
    
    # Run investigations
    investigate_used_stocks()
    check_so_details()
    check_accounting_with_akuntan()
    
    print("\n" + "="*80)
    print("INVESTIGATION COMPLETE")
    print("="*80)

if __name__ == "__main__":
    main()
