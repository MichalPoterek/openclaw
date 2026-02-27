const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage, DisconnectReason } = require('@whiskeysockets/baileys');
const { Client } = require('pg');
const pino = require('pino');
const fs = require('node:fs');
const path = require('node:path');

const MEDIA_DIR = '/home/mike/whatsapp-blackbox/media';

async function startArchiver() {
    const { state, saveCreds } = await useMultiFileAuthState('auth');
    
    // Konfiguracja z prośbą o pełną historię
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        syncFullHistory: true, // Kluczowe dla pobrania wszystkiego
        shouldSyncHistoryMessage: () => true // Pobieraj każdą wiadomość historyczną
    });

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
            console.log('Połączono! Rozpoczynam synchronizację pełnej historii...');
        }
    });

    // Obsługa masowego importu historii (to tu trafią stare wiadomości)
    sock.ev.on('messaging-history.set', async ({ chats, contacts, messages, isLatest }) => {
        console.log(`Otrzymano pakiet historyczny: ${messages.length} wiadomości, ${chats.length} czatów.`);
        for (const msg of messages) {
            await processSingleMessage(msg, pgClient);
        }
        if (isLatest) console.log('Synchronizacja historyczna zakończona (najnowszy pakiet).');
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

            // 1. Contact
            await pg.query(
                'INSERT INTO contacts (phone_number, push_name, last_message_at) VALUES ($1, $2, $3) ON CONFLICT (phone_number) DO UPDATE SET last_message_at = GREATEST(contacts.last_message_at, $3), push_name = COALESCE($2, contacts.push_name)',
                [sender, msg.pushName || null, timestamp]
            );

            // 2. Message
            const msgRes = await pg.query(
                'INSERT INTO messages (whatsapp_id, sender_number, body, chat_type, group_id, timestamp, raw_json) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (whatsapp_id) DO NOTHING RETURNING id',
                [msg.key.id, sender, body, chatType, jid, timestamp, JSON.stringify(msg)]
            );

            const internalId = msgRes.rows[0]?.id;
            if (!internalId) return;

            // 3. Media (tylko jeśli chcesz pobierać multimedia wstecz - może zająć dużo miejsca!)
            const mediaMsg = msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.audioMessage || msg.message?.documentMessage;
            if (mediaMsg) {
                // Pobieranie mediów z historii może być wolne, robimy to opcjonalnie
                // downloadMedia(msg, internalId, sender, timestamp, pg, mediaMsg); 
            }
            
            if (messages.length < 5) console.log(`[Logged] ${sender}: ${body.substring(0, 20)}...`);
        } catch (err) {}
    }

    console.log('Archiwizator z Full Sync uruchomiony...');
}

startArchiver().catch(err => console.error('Błąd:', err));
