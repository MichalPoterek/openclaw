import psycopg2
import json
from datetime import datetime

conn = psycopg2.connect(
    dbname="whatsapp_blackbox", 
    user="mike", 
    password="mike7106", 
    host="127.0.0.1"
)
cur = conn.cursor()

# Get missing media IDs
cur.execute("""
    SELECT id, raw_json, "timestamp", sender_number
    FROM messages 
    WHERE (raw_json->'message' ? 'imageMessage' 
       OR raw_json->'message' ? 'videoMessage' 
       OR raw_json->'message' ? 'documentMessage'
       OR raw_json->'message' ? 'audioMessage'
       OR raw_json->'message' ? 'stickerMessage')
    AND NOT EXISTS (SELECT 1 FROM media_archive WHERE message_id = messages.id)
    ORDER BY id ASC
""")

missing_messages = cur.fetchall()
output_file = "/home/mike/whatsapp-blackbox/missing_media_context.txt"

with open(output_file, "w", encoding="utf-8") as f:
    f.write("MISSING MEDIA CONTEXT REPORT - " + str(datetime.now()) + "\n")
    f.write("="*80 + "\n\n")

    for m_id, raw, ts, sender in missing_messages:
        remote_jid = raw.get('key', {}).get('remoteJid')
        msg_content = raw.get('message', {})
        
        m_type = "unknown"
        m_data = {}
        for key in ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'stickerMessage']:
            if key in msg_content:
                m_type = key.replace('Message', '')
                m_data = msg_content[key]
                break
        
        fname = str(m_data.get('fileName') or m_data.get('caption') or "[No metadata name]")
        f.write("--- [ID: " + str(m_id) + "] | Time: " + str(ts) + " | Chat: " + str(remote_jid) + " ---\n")
        f.write("FILE ATTEMPTED: " + m_type.upper() + " - " + fname + "\n")
        
        # Context fetch
        cur.execute("""
            SELECT sender_number, body, "timestamp"
            FROM messages 
            WHERE raw_json->'key'->>'remoteJid' = %s
            AND "timestamp" BETWEEN %s - interval '5 minutes' AND %s + interval '5 minutes'
            ORDER BY "timestamp" ASC
        """, (remote_jid, ts, ts))
        
        context = cur.fetchall()
        f.write("CONVERSATION CONTEXT:\n")
        for c_sender, c_body, c_ts in context:
            prefix = " >> " if c_ts == ts else "    "
            body_text = str(c_body).replace("\n", " ") if c_body else "[Media/System Message]"
            f.write(prefix + "[" + c_ts.strftime('%H:%M:%S') + "] " + c_sender.split('@')[0] + ": " + body_text + "\n")
        
        f.write("\n" + "."*40 + "\n\n")

print("Report generated: " + output_file)
cur.close()
conn.close()
