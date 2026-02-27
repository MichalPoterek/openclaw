const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage, DisconnectReason } = require('@whiskeysockets/baileys');
const { Client } = require('pg');
const pino = require('pino');
const fs = require('node:fs');
const path = require('node:path');

const MEDIA_DIR = '/home/mike/whatsapp-blackbox/media';
const PHONE_NUMBER = '48509879642'; // Twój numer

async function startArchiver() {
    const { state, saveCreds } = await useMultiFileAuthState('auth');
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });

    // Rejestracja kodu parowania
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            const code = await sock.requestPairingCode(PHONE_NUMBER);
            console.log('\n-----------------------------------------');
            console.log('TWÓJ KOD PAROWANIA WHATSAPP:');
            console.log('      ' + code);
            console.log('-----------------------------------------\n');
        }, 3000);
    }

    const pgClient = new Client({
        user: 'mike',
        host: '127.0.0.1',
        database: 'whatsapp_blackbox',
        password: 'mike7106',
        port: 5432,
    });
    await pgClient.connect();

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startArchiver();
        } else if (connection === 'open') {
            console.log('Połączono pomyślnie! Archiwizator jest aktywny.');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            try {
                const jid = msg.key.remoteJid;
                if (!jid) continue;
                const sender = jid.split('@')[0];
                const timestamp = new Date((msg.messageTimestamp || Date.now()/1000) * 1000);
                const chatType = jid.endsWith('@g.us') ? 'group' : 'direct';
                const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

                await pgClient.query(
                    'INSERT INTO contacts (phone_number, push_name, last_message_at) VALUES ($1, $2, $3) ON CONFLICT (phone_number) DO UPDATE SET last_message_at = $3, push_name = $2',
                    [sender, msg.pushName || null, timestamp]
                );

                const msgRes = await pgClient.query(
                    'INSERT INTO messages (whatsapp_id, sender_number, body, chat_type, group_id, timestamp, raw_json) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (whatsapp_id) DO NOTHING RETURNING id',
                    [msg.key.id, sender, body, chatType, jid, timestamp, JSON.stringify(msg)]
                );

                const internalId = msgRes.rows[0]?.id;
                if (!internalId) continue;

                const mediaMsg = msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.audioMessage || msg.message?.documentMessage;
                if (mediaMsg) {
                    try {
                        const buffer = await downloadMediaMessage(msg, 'buffer', {});
                        const dateStr = timestamp.toISOString().split('T')[0];
                        const dayDir = path.join(MEDIA_DIR, dateStr);
                        if (!fs.existsSync(dayDir)) fs.mkdirSync(dayDir, { recursive: true });
                        const mimetype = mediaMsg.mimetype || 'application/octet-stream';
                        const ext = mimetype.split('/')[1]?.split(';')[0] || 'bin';
                        const fileName = `${sender}_${timestamp.getTime()}.${ext}`;
                        const fullPath = path.join(dayDir, fileName);
                        fs.writeFileSync(fullPath, buffer);
                        await pgClient.query(
                            'INSERT INTO media_archive (message_id, local_path, mime_type, file_name, file_size) VALUES ($1, $2, $3, $4, $5)',
                            [internalId, fullPath, mimetype, fileName, buffer.length]
                        );
                        console.log(`[Media Saved] ${fullPath}`);
                    } catch (err) {}
                }
                console.log(`[Logged] ${sender}: ${body.substring(0, 30)}...`);
            } catch (err) {}
        }
    });
    console.log('Archiwizator uruchomiony...');
}

startArchiver().catch(err => console.error('Błąd:', err));
