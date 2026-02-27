import psycopg2, json

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
       OR raw_json->'message' ? 'documentMessage')
    AND NOT EXISTS (SELECT 1 FROM media_archive WHERE message_id = messages.id)
    LIMIT 10
""")

print("Unmatched Samples:")
for r in cur.fetchall():
    msg_id = r[0]
    raw_json = r[1]
    msg_content = raw_json.get('message', {})
    
    m_data = msg_content.get('imageMessage') or msg_content.get('videoMessage') or msg_content.get('documentMessage')
    
    if m_data:
        m_type = 'image' if 'imageMessage' in msg_content else 'video' if 'videoMessage' in msg_content else 'document'
        print("\nID: " + str(msg_id))
        print("Type: " + m_type)
        print("File Name: " + str(m_data.get('fileName')))
        print("File Size: " + str(m_data.get('fileLength')))
        print("Mime: " + str(m_data.get('mimetype')))
cur.close()
conn.close()
