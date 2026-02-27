const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage, DisconnectReason } = require('@whiskeysockets/baileys');
const { Client } = require('pg');
const pino = require('pino');
const fs = require('node:fs');
const path = require('node:path');
const qrcode = require('qrcode-terminal');

const MEDIA_DIR = '/home/mike/whatsapp-blackbox/media';

async function startArchiver() {
    const { state, saveCreds } = await useMultiFileAuthState('auth');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, 
        syncFullHistory: true,
        shouldSyncHistoryMessage: () => true
    });

    const pgClient = new Client({
        user: 'mike',
        host: '127.0.0.1',
        database: 'whatsapp_blackbox',
        password: 'mike7106',
        port: 5432,
    });
    
    try {
        await pgClient.connect();
    } catch (e) {}

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('\n=========================================');
            console.log('ZESKANUJ PONIŻSZY KOD QR W APLIKACJI WHATSAPP (Wymusza historie):');
            qrcode.generate(qr, {small: true});
            console.log('=========================================\n');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startArchiver();
        } else if (connection === 'open') {
            console.log('Połączono! Pobieram listę czatów...');
        }
    });

    sock.ev.on('messaging-history.set', async ({ chats, contacts, messages, isLatest }) => {
        console.log(`>>> OTRZYMANO PAKIET: ${messages.length} wiadomości.`);
        for (const msg of messages) {
            await processSingleMessage(msg, pgClient);
        }
        if (isLatest) console.log('>>> Pełna historia załadowana.');
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            await processSingleMessage(msg, pgClient);
        }
    });

    async function processSingleMessage(msg, pg) {
        try {
            const jid = msg.key.remoteJid;
            if (!jid || jid === 'status@broadcast') return;
            const sender = jid.split('@')[0];
            const timestamp = new Date((msg.messageTimestamp || Date.now()/1000) * 1000);
            const chatType = jid.endsWith('@g.us') ? 'group' : 'direct';
            const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

            await pg.query(
                'INSERT INTO contacts (phone_number, push_name, last_message_at) VALUES ($1, $2, $3) ON CONFLICT (phone_number) DO UPDATE SET last_message_at = GREATEST(contacts.last_message_at, $3), push_name = COALESCE($2, contacts.push_name)',
                [sender, msg.pushName || null, timestamp]
            );

            await pg.query(
                'INSERT INTO messages (whatsapp_id, sender_number, body, chat_type, group_id, timestamp, raw_json) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (whatsapp_id) DO NOTHING',
                [msg.key.id, sender, body, chatType, jid, timestamp, JSON.stringify(msg)]
            );
        } catch (err) {}
    }

    console.log('Archiwizator aktywny...');
}

startArchiver().catch(err => {
    console.error('Błąd:', err);
});