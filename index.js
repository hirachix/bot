require('./settings');
const fs = require('fs');
const pino = require('pino');
const path = require('path');
const axios = require('axios');
const chalk = require('chalk');
const readline = require('readline');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const NodeCache = require('node-cache');
const { toBuffer } = require('qrcode');
const { exec } = require('child_process');
const { parsePhoneNumber } = require('awesome-phonenumber');
const {
    default: WAConnection,
    useMultiFileAuthState,
    Browsers,
    DisconnectReason,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion
} = require('baileys');

const { dataBase } = require('./src/database');
const { app, server, PORT } = require('./src/server');

const pairingCode = process.argv.includes('--qr') ? false : process.argv.includes('--pairing-code') || global.pairing_code;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));
let pairingStarted = false;
let phoneNumber;

global.fetchApi = async (path = '/', query = {}, options) => {
    const urlnya = (
        options?.name || options
            ? (options?.name || options) in global.APIs
                ? global.APIs[options?.name || options]
                : options?.name || options
            : global.APIs['hitori']
                ? global.APIs['hitori']
                : options?.name || options
    ) + path + (query ? '?' + decodeURIComponent(new URLSearchParams(Object.entries({ ...query }))) : '');
    const { data } = await axios.get(urlnya, {
        ...(options?.name || options
            ? {}
            : { headers: { accept: 'application/json', 'x-api-key': global.APIKeys[global.APIs['hitori']] } })
    });
    return data;
};

const storeDB = dataBase(global.tempatStore);
const database = dataBase(global.tempatDB);
const msgRetryCounterCache = new NodeCache();
const groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false });

server.listen(PORT, () => {
    console.log(chalk.greenBright(`✅ [SERVER] Aktif di Port: ${PORT}`));
    console.log(chalk.blueBright(`🌐 URL: http://localhost:${PORT}`));
    console.log(chalk.yellowBright('🚀 HirakoBot siap melayani Anda!\n'));
});

const { GroupParticipantsUpdate, MessagesUpsert, Solving } = require('./src/message');
const { isUrl, generateMessageTag, getBuffer, getSizeMedia, fetchJson, sleep } = require('./lib/function');

async function starthirakoBot() {
    const { state, saveCreds } = await useMultiFileAuthState('hirakodev');
    const { version } = await fetchLatestBaileysVersion();
    const level = pino({ level: 'silent' });

    try {
        const loadData = await database.read();
        const storeLoadData = await storeDB.read();
        if (!loadData || Object.keys(loadData).length === 0) {
            global.db = {
                hit: {},
                set: {},
                list: {},
                store: {},
                users: {},
                game: {},
                groups: {},
                database: {},
                premium: [],
                sewa: [],
                ...(loadData || {})
            };
            await database.write(global.db);
        } else {
            global.db = loadData;
        }
        if (!storeLoadData || Object.keys(storeLoadData).length === 0) {
            global.store = {
                contacts: {},
                presences: {},
                messages: {},
                groupMetadata: {},
                ...(storeLoadData || {})
            };
            await storeDB.write(global.store);
        } else {
            global.store = storeLoadData;
        }

        setInterval(async () => {
            if (global.db) await database.write(global.db);
            if (global.store) await storeDB.write(global.store);
        }, 30 * 1000);
    } catch (e) {
        console.log(e);
        process.exit(1);
    }

    store.loadMessage = function (remoteJid, id) {
        const messages = store.messages?.[remoteJid]?.array;
        if (!messages) return null;
        return messages.find(msg => msg?.key?.id === id) || null;
    };

    const getMessage = async (key) => {
        if (store) {
            const msg = await store.loadMessage(key.remoteJid, key.id);
            return msg?.message || '';
        }
        return { conversation: 'Halo Saya Hirako Bot' };
    };

    const hirako = WAConnection({
        logger: level,
        getMessage,
        syncFullHistory: true,
        maxMsgRetryCount: 15,
        msgRetryCounterCache,
        retryRequestDelayMs: 10,
        defaultQueryTimeoutMs: 0,
        connectTimeoutMs: 60000,
        browser: Browsers.ubuntu('Chrome'),
        generateHighQualityLinkPreview: true,
        cachedGroupMetadata: async (jid) => groupCache.get(jid),
        shouldSyncHistoryMessage: msg => {
            console.log(chalk.cyan(`⏳ Memuat Chat [${msg.progress || 0}%]`));
            return !!msg.syncType;
        },
        transactionOpts: {
            maxCommitRetries: 10,
            delayBetweenTriesMs: 10
        },
        appStateMacVerification: {
            patch: true,
            snapshot: true
        },
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, level)
        }
    });

    if (pairingCode && !phoneNumber && !hirako.authState.creds.registered) {
        async function getPhoneNumber() {
            phoneNumber = global.number_bot ? global.number_bot : process.env.BOT_NUMBER || await question('Please type your WhatsApp number : ');
            phoneNumber = phoneNumber.replace(/[^0-9]/g, '');

            if (!parsePhoneNumber('+' + phoneNumber).valid && phoneNumber.length < 6) {
                console.log(chalk.bgBlack(chalk.redBright('Start with your Country WhatsApp code') + chalk.whiteBright(',') + chalk.greenBright(' Example : 62xxx')));
                await getPhoneNumber();
            }
        }
        (async () => {
            await getPhoneNumber();
            await exec('rm -rf ./hirakodev/*');
            console.log(chalk.blueBright('📞 Nomor ditangkap. Menunggu Koneksi...\n⏳ Perkiraan: 2 ~ 5 menit'));
        })();
    }

    await Solving(hirako, store);

    hirako.ev.on('creds.update', saveCreds);

    hirako.ev.on('connection.update', async (update) => {
        const { qr, connection, lastDisconnect, isNewLogin, receivedPendingNotifications } = update;
        if (!hirako.authState.creds.registered) console.log(chalk.gray(`🔗 Connection: ${connection || false}`));
        if ((connection === 'connecting' || !!qr) && pairingCode && phoneNumber && !hirako.authState.creds.registered && !pairingStarted) {
            setTimeout(async () => {
                pairingStarted = true;
                console.log(chalk.magenta('🗝️ Meminta Pairing Code...'));
                let code = await hirako.requestPairingCode(phoneNumber);
                console.log(chalk.yellow(`🔑 Kode Pairing Anda : ${code}`));
            }, 3000);
        }
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
            console.log(chalk.redBright(`❌ Koneksi tertutup [Alasan: ${reason}]. Mencoba ulang...`));
            starthirakoBot();
        }
        if (connection === 'open') {
            console.log(chalk.greenBright(`✅ [CONNECTED] ${JSON.stringify(hirako.user, null, 2)}`));
        }
        if (qr && !pairingCode) {
            console.log(chalk.blueBright('📸 Scan QR berikut untuk login:'));
            qrcode.generate(qr, { small: true });
            app.use('/qr', async (req, res) => {
                res.setHeader('content-type', 'image/png');
                res.end(await toBuffer(qr));
            });
        }
        if (isNewLogin) console.log(chalk.greenBright('🎉 Login Baru Terdeteksi!'));
        if (receivedPendingNotifications == 'true') {
            console.log(chalk.yellow('⌛ Harap Tunggu ±1 Menit...'));
            hirako.ev.flush();
        }
    });

    hirako.ev.on('contacts.update', (update) => {
        for (let contact of update) {
            let id = hirako.decodeJid(contact.id);
            if (store && store.contacts) store.contacts[id] = { id, name: contact.notify };
        }
    });

    hirako.ev.on('call', async (call) => {
        let botNumber = await hirako.decodeJid(hirako.user.id);
        if (global.db?.set[botNumber]?.anticall) {
            for (let id of call) {
                if (id.status === 'offer') {
                    let msg = await hirako.sendMessage(id.from, {
                        text: `📵 Saat ini saya tidak dapat menerima panggilan ${id.isVideo ? 'Video' : 'Suara'}.\nSilakan hubungi owner jika perlu bantuan.`,
                        mentions: [id.from]
                    });
                    await hirako.sendContact(id.from, global.owner, msg);
                    await hirako.rejectCall(id.id, id.from);
                }
            }
        }
    });

    hirako.ev.on('messages.upsert', async (message) => {
        await MessagesUpsert(hirako, message, store, groupCache);
    });

    hirako.ev.on('group-participants.update', async (update) => {
        await GroupParticipantsUpdate(hirako, update, store, groupCache);
    });

    hirako.ev.on('groups.update', (update) => {
        for (const n of update) {
            if (store.groupMetadata[n.id]) {
                groupCache.set(n.id, n);
                Object.assign(store.groupMetadata[n.id], n);
            }
        }
    });

    hirako.ev.on('presence.update', ({ id, presences: update }) => {
        store.presences[id] = store.presences?.[id] || {};
        Object.assign(store.presences[id], update);
    });

    setInterval(async () => {
        if (hirako?.user?.id) await hirako.sendPresenceUpdate('available', hirako.decodeJid(hirako.user.id)).catch(e => {});
    }, 10 * 60 * 1000);

    return hirako;
}

starthirakoBot();

const cleanup = async (signal) => {
    console.log(chalk.yellowBright(`⚙️ Received ${signal}. Menyimpan database...`));
    if (global.db) await database.write(global.db);
    if (global.store) await storeDB.write(global.store);
    server.close(() => {
        console.log(chalk.redBright('👋 Server ditutup. Sampai jumpa lagi!'));
        process.exit(0);
    });
};

process.on('SIGINT', () => cleanup('SIGINT'));
process.on('SIGTERM', () => cleanup('SIGTERM'));
process.on('exit', () => cleanup('exit'));

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.log(chalk.redBright(`⚠️ Port ${PORT} sudah digunakan. Coba port lain.`));
        server.close();
    } else console.error('[SERVER ERROR]:', error);
});

setInterval(() => {}, 1000 * 60 * 10);

let file = require.resolve(__filename);
fs.watchFile(file, () => {
    fs.unwatchFile(file);
    console.log(chalk.redBright(`🔄 Update ${__filename}`));
    delete require.cache[file];
    require(file);
});