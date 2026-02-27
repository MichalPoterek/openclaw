import json
import os
import psycopg2
import re
from datetime import datetime

# DB Connection
conn = psycopg2.connect(
    dbname="whatsapp_blackbox",
    user="mike",
    password="mike7106",
    host="127.0.0.1",
    port="5432"
)
cur = conn.cursor()

MEDIA_ROOT = "/home/mike/whatsapp-blackbox/Media"

# Pre-index all files in the 18GB folder by size for fast matching
print("Indexing 18GB media folder... this might take a moment.")
file_index = {} # key: size, value: list of paths
for root, dirs, files in os.walk(MEDIA_ROOT):
    for f in files:
        full_path = os.path.join(root, f)
        try:
            size = os.path.getsize(full_path)
            if size not in file_index:
                file_index[size] = []
            file_index[size].append(full_path)
        except OSError:
            continue

print(f"Indexed {sum(len(v) for v in file_index.values())} files.")

def find_file_by_metadata(filename, size, timestamp):
    # 1. Match by exact size (Fastest)
    if size and int(size) in file_index:
        possible_paths = file_index[int(size)]
        if len(possible_paths) == 1:
            return possible_paths[0]
        
        # 2. If multiple files have the same size, match by date in filename
        # WhatsApp format: IMG-YYYYMMDD-WA...
        date_str = datetime.fromtimestamp(timestamp).strftime('%Y%m%d')
        for p in possible_paths:
            if date_str in os.path.basename(p):
                return p
        
        # 3. If no date match, try exact filename if provided
        if filename:
            for p in possible_paths:
                if filename in os.path.basename(p):
                    return p
                    
    # 4. Fallback: just by filename if size didn't work
    if filename:
        subfolders = ["WhatsApp Images", "WhatsApp Video", "WhatsApp Documents", "WhatsApp Audio", "WhatsApp Voice Notes", "WhatsApp Stickers"]
        for sub in subfolders:
            paths = [os.path.join(MEDIA_ROOT, sub, filename), os.path.join(MEDIA_ROOT, sub, "Sent", filename), os.path.join(MEDIA_ROOT, sub, "Private", filename)]
            for p in paths:
                if os.path.exists(p): return p
                
    return None

print("Starting advanced media linking...")

cur.execute("""
    SELECT id, raw_json, "timestamp"
    FROM messages 
    WHERE raw_json->'message' ? 'imageMessage' 
       OR raw_json->'message' ? 'videoMessage' 
       OR raw_json->'message' ? 'documentMessage' 
       OR raw_json->'message' ? 'audioMessage'
       OR raw_json->'message' ? 'stickerMessage'
""")

rows = cur.fetchall()
linked_count = 0
not_found_count = 0
already_linked = 0

for msg_id, raw_json, db_timestamp in rows:
    cur.execute("SELECT 1 FROM media_archive WHERE message_id = %s", (msg_id,))
    if cur.fetchone():
        already_linked += 1
        continue

    msg_content = raw_json.get('message', {})
    media_data = None
    if 'imageMessage' in msg_content: media_data = msg_content['imageMessage']
    elif 'videoMessage' in msg_content: media_data = msg_content['videoMessage']
    elif 'documentMessage' in msg_content: media_data = msg_content['documentMessage']
    elif 'audioMessage' in msg_content: media_data = msg_content['audioMessage']
    elif 'stickerMessage' in msg_content: media_data = msg_content['stickerMessage']

    if media_data:
        file_name = media_data.get('fileName') or media_data.get('caption')
        file_size = media_data.get('fileLength')
        # Use timestamp from the message record (which is a datetime object)
        ts = int(db_timestamp.timestamp())
        
        local_path = find_file_by_metadata(file_name, file_size, ts)
        
        if local_path:
            cur.execute("""
                INSERT INTO media_archive (message_id, local_path, mime_type, file_name, file_size)
                VALUES (%s, %s, %s, %s, %s)
            """, (msg_id, local_path, media_data.get('mimetype'), file_name or os.path.basename(local_path), file_size))
            linked_count += 1
        else:
            not_found_count += 1

conn.commit()
print(f"Summary:")
print(f"- Linked {linked_count} new media files.")
print(f"- {already_linked} files were already linked.")
print(f"- {not_found_count} media messages could not be matched.")
cur.close()
conn.close()
