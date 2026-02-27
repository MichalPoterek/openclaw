import psycopg2
import json

conn = psycopg2.connect(
    dbname="whatsapp_blackbox", 
    user="mike", 
    password="mike7106", 
    host="127.0.0.1"
)
cur = conn.cursor()

cur.execute("""
    SELECT id, raw_json 
    FROM messages 
    WHERE (raw_json->'message' ? 'imageMessage' 
       OR raw_json->'message' ? 'videoMessage' 
       OR raw_json->'message' ? 'documentMessage'
       OR raw_json->'message' ? 'audioMessage'
       OR raw_json->'message' ? 'stickerMessage')
    AND NOT EXISTS (SELECT 1 FROM media_archive WHERE message_id = messages.id)
    ORDER BY id ASC
""")

print("ID       | Type       | File Name / Caption")
print("-" * 70)

for r in cur.fetchall():
    msg_id = r[0]
    raw = r[1]
    msg = raw.get('message', {})
    
    m_type = "unknown"
    m_data = {}
    for key in ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'stickerMessage']:
        if key in msg:
            m_type = key.replace('Message', '')
            m_data = msg[key]
            break
            
    fname = m_data.get('fileName') or m_data.get('caption') or "[No Name Found]"
    # Manual string cleaning for simple display
    fname_clean = str(fname).replace("\n", " ").strip()
    if len(fname_clean) > 50:
        fname_clean = fname_clean[:47] + "..."
        
    print(str(msg_id).ljust(8) + " | " + m_type.ljust(10) + " | " + fname_clean)

cur.close()
conn.close()
