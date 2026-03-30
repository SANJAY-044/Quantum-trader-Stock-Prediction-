import os
import time
import json
import traceback
from flask import Flask, jsonify, request
from flask_cors import CORS
import yfinance as yf
import pandas as pd
import numpy as np

app = Flask(__name__, static_folder="frontend", static_url_path="")
CORS(app) # Enable CORS for all routes

# Simple in-memory cache
CACHE = {}
CACHE_TTL = 3600  # 1 hour

def calculate_indicators(df):
    try:
        print(f"--> [DATA PROCESSING] Original DataFrame Shape: {df.shape}")
        
        # Moving Averages
        df['MA20'] = df['Close'].rolling(window=20).mean()
        df['MA50'] = df['Close'].rolling(window=50).mean()
        
        # RSI (14 periods)
        delta = df['Close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss
        df['RSI'] = 100 - (100 / (1 + rs))
        
        # MACD
        exp1 = df['Close'].ewm(span=12, adjust=False).mean()
        exp2 = df['Close'].ewm(span=26, adjust=False).mean()
        df['MACD'] = exp1 - exp2
        
        # Fill NaN values with backfill then 0
        df.bfill(inplace=True)
        df.fillna(0, inplace=True)
        
        print(f"--> [DATA PROCESSING] Appended Features: MA20, MA50, RSI, MACD")
        print(f"--> [DATA PROCESSING] Final Processed Shape: {df.shape}")
        
    except Exception as e:
        print("Error calculating indicators:", e)
    
    return df

def get_stock_data(symbol, period="2y"):
    print(f"\n======================================")
    print(f"--> [API REQUEST] Fetching Data for {symbol} ({period})...")
    cache_key = f"{symbol}_{period}"
    now = time.time()
    if cache_key in CACHE:
        cached_data, timestamp = CACHE[cache_key]
        if now - timestamp < CACHE_TTL:
            return cached_data
            
    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=period, interval="1d")
        
        if df.empty:
            return None
            
        df = df.reset_index()
        if df['Date'].dt.tz is not None:
            df['Date'] = df['Date'].dt.tz_convert(None)
        
        df = calculate_indicators(df)
        
        print(f"--> [API RESPONSE] Compiling {len(df)} rows to JSON...")
        
        rows = []
        for _, r in df.iterrows():
            try:
                d_str = r['Date'].strftime('%Y-%m-%d')
            except:
                d_str = str(r['Date']).split(' ')[0]
                
            rows.append({
                'date': d_str,
                'open': round(float(r['Open']), 4),
                'high': round(float(r['High']), 4),
                'low': round(float(r['Low']), 4),
                'close': round(float(r['Close']), 4),
                'vol': int(r['Volume']) if not pd.isna(r['Volume']) else 0,
                'ma20': round(float(r.get('MA20', 0)), 4),
                'ma50': round(float(r.get('MA50', 0)), 4),
                'rsi': round(float(r.get('RSI', 0)), 4),
                'macd': round(float(r.get('MACD', 0)), 4)
            })
            
        CACHE[cache_key] = (rows, now)
        return rows
    except Exception as e:
        print(f"yfinance error for {symbol}: {e}")
        return None

@app.route('/')
def serve_index():
    return app.send_static_file('index.html')

@app.route('/api/stock')
def get_stock():
    symbol = request.args.get('symbol', 'AAPL').upper()
    try:
        data = get_stock_data(symbol, period="2y")
        if data is None:
            return jsonify({'error': 'Invalid stock symbol or no data found'}), 404
        return jsonify(data)
    except Exception as e:
        print(f"Error fetching data for {symbol}:")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/history')
def get_history():
    symbol = request.args.get('symbol', 'AAPL').upper()
    period = request.args.get('period', '2y')
    valid_periods = ['1mo', '3mo', '6mo', '1y', '2y', '5y', 'max']
    if period not in valid_periods:
        return jsonify({'error': 'Invalid period'}), 400
        
    try:
        data = get_stock_data(symbol, period=period)
        if data is None:
            return jsonify({'error': 'No data found'}), 404
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/log', methods=['POST'])
def log_frontend_error():
    print("--- FRONTEND ERROR REPORT ---")
    print(request.data.decode('utf-8'))
    print("-----------------------------")
    return jsonify({"status": "logged"})

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
