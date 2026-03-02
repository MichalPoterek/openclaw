import psycopg2
import os
import sys

def search_logs():
    try:
        conn = psycopg2.connect(host='127.0.0.1', database='whatsapp_blackbox', user='mike', password=os.environ.get('PG_PASSWORD', 'changeme'))
        cur = conn.cursor()
        query = """
            SELECT timestamp, body 
            FROM messages 
            WHERE chat_type = 'direct' 
            AND (body ILIKE '%zabezpiecz%' 
                 OR body ILIKE '%prywatność%' 
                 OR body ILIKE '%ustawieni%' 
                 OR body ILIKE '%openclaw.json%'
                 OR body ILIKE '%policy%')
            ORDER BY timestamp DESC 
            LIMIT 30
        """
        cur.execute(query)
        rows = cur.fetchall()
        for r in rows:
            print(f'[{r[0]}] {r[1][:500]}')
            print('-'*40)
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    search_logs()
