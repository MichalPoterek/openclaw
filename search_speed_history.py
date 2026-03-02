import psycopg2
import os

def search_speed():
    try:
        conn = psycopg2.connect(host='127.0.0.1', database='whatsapp_blackbox', user='mike', password=os.environ.get('PG_PASSWORD', 'changeme'))
        cur = conn.cursor()
        query = """
            SELECT timestamp, body 
            FROM messages 
            WHERE (body ILIKE '%600%t/s%' OR body ILIKE '%300%t/s%' OR body ILIKE '%600%token%' OR body ILIKE '%300%token%' OR body ILIKE '%600%tps%' OR body ILIKE '%300%tps%')
            ORDER BY timestamp DESC 
        """
        cur.execute(query)
        rows = cur.fetchall()
        print(f"Found {len(rows)} potential speed records.\n")
        for r in rows:
            print(f"[{r[0]}]")
            print(r[1])
            print("-" * 50)
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    search_speed()
