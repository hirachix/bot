require('../settings');
const fs = require('fs');
const path = require('path');
const https = require('https');
const axios = require('axios');
const chalk = require('chalk');
const crypto = require('crypto');
const FileType = require('file-type');
const PhoneNumber = require('awesome-phonenumber');

const { checkStatus } = require('./database');
const { imageToWebp, videoToWebp, writeExif, gifToWebp } = require('../lib/exif');
const { isUrl, getGroupAdmins, generateMessageTag, getBuffer, getSizeMedia, fetchJson, sleep, getTypeUrlMedia } = require('../lib/function');
const { jidNormalizedUser, proto, getBinaryNodeChildren, getBinaryNodeChild, generateMessageIDV2, jidEncode, encodeSignedDeviceIdentity, generateWAMessageContent, generateForwardMessageContent, prepareWAMessageMedia, delay, areJidsSameUser, extractMessageContent, generateMessageID, downloadContentFromMessage, generateWAMessageFromContent, jidDecode, generateWAMessage, toBuffer, getContentType, WAMessageStubType, getDevice } = require('baileys');

/*
	* Create By hirako
	* Follow https://github.com/hirakodev
	* Whatsapp : https://whatsapp.com/channel/0029VaWOkNm7DAWtkvkJBK43
*/

async function GroupUpdate(hirako, m, store) {
	if (!m.messageStubType || !m.isGroup) return
	if (global.db?.groups?.[m.chat]?.setinfo && hirako.public) {
		const admin = `@${m.sender.split`@`[0]}`
		const messages = {
			1: 'mereset link grup!',
			21: `mengubah Subject Grup menjadi :\n*${m.messageStubParameters[0]}*`,
			22: 'telah mengubah icon grup.',
			23: 'mereset link grup!',
			24: `mengubah deskripsi grup.\n\n${m.messageStubParameters[0]}`,
			25: `telah mengatur agar *${m.messageStubParameters[0] == 'on' ? 'hanya admin' : 'semua peserta'}* yang dapat mengedit info grup.`,
			26: `telah *${m.messageStubParameters[0] == 'on' ? 'menutup' : 'membuka'}* grup!\nSekarang ${m.messageStubParameters[0] == 'on' ? 'hanya admin yang' : 'semua peserta'} dapat mengirim pesan.`,
			29: `telah menjadikan @${m.messageStubParameters[0].split`@`[0]} sebagai admin.`,
			30: `telah memberhentikan @${m.messageStubParameters[0].split`@`[0]} dari admin.`,
			72: `mengubah durasi pesan sementara menjadi *@${m.messageStubParameters[0]}*`,
			123: 'menonaktifkan pesan sementara.',
			132: 'mereset link grup!',
		}
		if (messages[m.messageStubType]) {
			await hirako.sendMessage(m.chat, { text: `${admin} ${messages[m.messageStubType]}`, mentions: [m.sender, ...(m.messageStubParameters[0]?.includes('@') ? [`${m.messageStubParameters[0]}`] : [])]}, { ephemeralExpiration: m.expiration || store?.messages[m.chat]?.array?.slice(-1)[0]?.metadata?.ephemeralDuration || 0 })
		} else {
			console.log({
				messageStubType: m.messageStubType,
				messageStubParameters: m.messageStubParameters,
				type: WAMessageStubType[m.messageStubType],
			})
		}
	}
}

async function GroupParticipantsUpdate(hirako, { id, participants, author, action }, store, groupCache) {
	try {
		function updateAdminStatus(participants, metadataParticipants, status) {
			for (const participant of metadataParticipants) {
				let id = jidNormalizedUser(participant.id);
				if (participants.includes(id)) {
					participant.admin = status;
				}
			}
		}
		if (global.db?.groups?.[id] && store?.groupMetadata?.[id]) {
			const metadata = store.groupMetadata[id];
			for (let n of participants) {
				let profile;
				try {
					profile = await hirako.profilePictureUrl(n, 'image');
				} catch {
					profile = 'https://telegra.ph/file/95670d63378f7f4210f03.png';
				}
				let messageText;
				if (action === 'add') {
					if (db.groups[id].welcome) messageText = db.groups[id]?.text?.setwelcome || `Welcome to ${metadata.subject}\n@`;
					metadata.participants.push({ id: jidNormalizedUser(n), admin: null });
				} else if (action === 'remove') {
					if (db.groups[id].leave) messageText = db.groups[id]?.text?.setleave || `@\nLeaving From ${metadata.subject}`;
					metadata.participants = metadata.participants.filter(p => !participants.includes(jidNormalizedUser(p.id)));
				} else if (action === 'promote') {
					if (db.groups[id].promote) messageText = db.groups[id]?.text?.setpromote || `@\nPromote From ${metadata.subject}\nBy @admin`;
					updateAdminStatus(participants, metadata.participants, 'admin');
				} else if (action === 'demote') {
					if (db.groups[id].demote) messageText = db.groups[id]?.text?.setdemote || `@\nDemote From ${metadata.subject}\nBy @admin`;
					updateAdminStatus(participants, metadata.participants, null);
				}
				groupCache.set(id, metadata);
				if (messageText && hirako.public) {
					await hirako.sendMessage(id, {
						text: messageText.replace('@subject', author ? `${metadata.subject}` : '@subject').replace('@admin', author ? `@${author.split('@')[0]}` : '@admin').replace(/(?<=\s|^)@(?!\w)/g, `@${n.split('@')[0]}`),
						contextInfo: {
							mentionedJid: [n, author],
							externalAdReply: {
								title: action == 'add' ? 'Welcome' : action == 'remove' ? 'Leaving' : action.charAt(0).toUpperCase() + action.slice(1),
								mediaType: 1,
								previewType: 0,
								thumbnailUrl: profile,
								renderLargerThumbnail: true,
								sourceUrl: global.my.gh
							}
						}
					}, { ephemeralExpiration: store?.messages[id]?.array?.slice(-1)[0]?.metadata?.ephemeralDuration || 0 });
				}
			}
		}
	} catch (e) {
		throw e;
	}
}

async function LoadDataBase(hirako, m) {
	try {
		const botNumber = await hirako.decodeJid(hirako.user.id);
		let game = global.db.game || {};
		let premium = global.db.premium || [];
		let user = global.db.users[m.sender] || {};
		let setBot = global.db.set[botNumber] || {};
		
		global.db.game = game;
		global.db.users[m.sender] = user;
		global.db.set[botNumber] = setBot;
		
		const defaultSetBot = {
			lang: 'id',
			limit: 0,
			money: 0,
			status: 0,
			join: false,
			public: true,
			anticall: true,
			original: true,
			readsw: false,
			autobio: false,
			autoread: true,
			antispam: false,
			autotyping: true,
			grouponly: true,
			multiprefix: false,
			privateonly: true,
			autobackup: false,
			template: 'documentMessage',
		};
		for (let key in defaultSetBot) {
			if (!(key in setBot)) setBot[key] = defaultSetBot[key];
		}
		
		const limitUser = user.vip ? global.limit.vip : checkStatus(m.sender, premium) ? global.limit.premium : global.limit.free;
		const moneyUser = user.vip ? global.money.vip : checkStatus(m.sender, premium) ? global.money.premium : global.money.free;
		
		const defaultUser = {
			vip: false,
			ban: false,
			afkTime: -1,
			afkReason: '',
			register: false,
			limit: limitUser,
			money: moneyUser,
			lastclaim: Date.now(),
			lastbegal: Date.now(),
			lastrampok: Date.now(),
		};
		for (let key in defaultUser) {
			if (!(key in user)) user[key] = defaultUser[key];
		}
		
		if (m.isGroup) {
			let group = global.db.groups[m.chat] || {};
			global.db.groups[m.chat] = group;
			
			const defaultGroup = {
				url: '',
				text: {},
				warn: {},
				tagsw: {},
				nsfw: false,
				mute: false,
				leave: false,
				setinfo: false,
				antilink: false,
				demote: false,
				antitoxic: false,
				promote: false,
				welcome: false,
				antivirtex: false,
				antitagsw: false,
				antidelete: false,
				antihidetag: false,
				waktusholat: false,
			};
			for (let key in defaultGroup) {
				if (!(key in group)) group[key] = defaultGroup[key];
			}
		}
		
		const defaultGame = {
			suit: {},
			chess: {},
			chat_ai: {},
			menfes: {},
			tekateki: {},
			akinator: {},
			tictactoe: {},
			tebaklirik: {},
			kuismath: {},
			blackjack: {},
			tebaklagu: {},
			tebakkata: {},
			family100: {},
			susunkata: {},
			tebakbom: {},
			ulartangga: {},
			tebakkimia: {},
			caklontong: {},
			tebakangka: {},
			tebaknegara: {},
			tebakgambar: {},
			tebakbendera: {},
		};
		for (let key in defaultGame) {
			if (!(key in game)) game[key] = defaultGame[key];
		}
		
	} catch (e) {
		throw e
	}
}

async function MessagesUpsert(hirako, message, store, groupCache) {
	try {
		let botNumber = await hirako.decodeJid(hirako.user.id);
		const msg = message.messages[0];
		const remoteJid = msg.key.remoteJid;
		store.messages[remoteJid] ??= {};
		store.messages[remoteJid].array ??= [];
		store.messages[remoteJid].keyId ??= new Set();
		if (!(store.messages[remoteJid].keyId instanceof Set)) {
			store.messages[remoteJid].keyId = new Set(store.messages[remoteJid].array.map(m => m.key.id));
		}
		if (store.messages[remoteJid].keyId.has(msg.key.id)) return;
		store.messages[remoteJid].array.push(msg);
		store.messages[remoteJid].keyId.add(msg.key.id);
		if (store.messages[remoteJid].array.length > (global.chatLength || 250)) {
			const removed = store.messages[remoteJid].array.shift();
			store.messages[remoteJid].keyId.delete(removed.key.id);
		}
		if (!store.groupMetadata || Object.keys(store.groupMetadata).length === 0) store.groupMetadata ??= await hirako.groupFetchAllParticipating().catch(e => ({}));
		const type = msg.message ? (getContentType(msg.message) || Object.keys(msg.message)[0]) : '';
		const m = await Serialize(hirako, msg, store, groupCache)
		require('../hirako')(hirako, m, msg, store, groupCache);
		if (db?.set?.[botNumber]?.readsw && msg.key.remoteJid === 'status@broadcast') {
			await hirako.readMessages([msg.key]);
			if (/protocolMessage/i.test(type)) await hirako.sendFromOwner(global.owner, 'Status dari @' + msg.key.participant.split('@')[0] + ' Telah dihapus', msg, { mentions: [msg.key.participant] });
			if (/(audioMessage|imageMessage|videoMessage|extendedTextMessage)/i.test(type)) {
				let keke = (type == 'extendedTextMessage') ? `Story Teks Berisi : ${msg.message.extendedTextMessage.text ? msg.message.extendedTextMessage.text : ''}` : (type == 'imageMessage') ? `Story Gambar ${msg.message.imageMessage.caption ? 'dengan Caption : ' + msg.message.imageMessage.caption : ''}` : (type == 'videoMessage') ? `Story Video ${msg.message.videoMessage.caption ? 'dengan Caption : ' + msg.message.videoMessage.caption : ''}` : (type == 'audioMessage') ? 'Story Audio' : '\nTidak diketahui cek saja langsung'
				await hirako.sendFromOwner(global.owner, `Melihat story dari @${msg.key.participant.split('@')[0]}\n${keke}`, msg, { mentions: [msg.key.participant] });
			}
		}
	} catch (e) {
		throw e;
	}
}

async function Solving(hirako, store) {
	hirako.serializeM = (m) => MessagesUpsert(hirako, m, store)
	
	hirako.decodeJid = (jid) => {
		if (!jid) return jid
		if (/:\d+@/gi.test(jid)) {
			let decode = jidDecode(jid) || {}
			return decode.user && decode.server && decode.user + '@' + decode.server || jid
		} else return jid
	}
	
	hirako.getName = (jid, withoutContact  = false) => {
		const id = hirako.decodeJid(jid);
		if (id.endsWith('@g.us')) {
			const groupInfo = store.contacts[id] || (store.groupMetadata[id] ? store.groupMetadata[id] : (store.groupMetadata[id] = hirako.groupMetadata(id))) || {};
			return Promise.resolve(groupInfo.name || groupInfo.subject || PhoneNumber('+' + id.replace('@g.us', '')).getNumber('international'));
		} else {
			if (id === '0@s.whatsapp.net') {
				return 'WhatsApp';
			}
		const contactInfo = store.contacts[id] || {};
		return withoutContact ? '' : contactInfo.name || contactInfo.subject || contactInfo.verifiedName || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international');
		}
	}
	
	hirako.sendContact = async (jid, kon, quoted = '', opts = {}) => {
		let list = []
		for (let i of kon) {
			list.push({
				displayName: await hirako.getName(i + '@s.whatsapp.net'),
				vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${await hirako.getName(i + '@s.whatsapp.net')}\nFN:${await hirako.getName(i + '@s.whatsapp.net')}\nitem1.TEL;waid=${i}:${i}\nitem1.X-ABLabel:Ponsel\nitem2.ADR:;;Indonesia;;;;\nitem2.X-ABLabel:Region\nEND:VCARD` //vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${await hirako.getName(i + '@s.whatsapp.net')}\nFN:${await hirako.getName(i + '@s.whatsapp.net')}\nitem1.TEL;waid=${i}:${i}\nitem1.X-ABLabel:Ponsel\nitem2.EMAIL;type=INTERNET:whatsapp@gmail.com\nitem2.X-ABLabel:Email\nitem3.URL:https://instagram.com/hirako_dev\nitem3.X-ABLabel:Instagram\nitem4.ADR:;;Indonesia;;;;\nitem4.X-ABLabel:Region\nEND:VCARD`
			})
		}
		hirako.sendMessage(jid, { contacts: { displayName: `${list.length} Kontak`, contacts: list }, ...opts }, { quoted, ephemeralExpiration: quoted?.expiration || store?.messages[jid]?.array?.slice(-1)[0]?.metadata?.ephemeralDuration || 0 });
	}
	
	hirako.profilePictureUrl = async (jid, type = 'image', timeoutMs) => {
		const result = await hirako.query({
			tag: 'iq',
			attrs: {
				target: jidNormalizedUser(jid),
				to: '@s.whatsapp.net',
				type: 'get',
				xmlns: 'w:profile:picture'
			},
			content: [{
				tag: 'picture',
				attrs: {
					type, query: 'url'
				},
			}]
		}, timeoutMs);
		const child = getBinaryNodeChild(result, 'picture');
		return child?.attrs?.url;
	}
	
	hirako.setStatus = (status) => {
		hirako.query({
			tag: 'iq',
			attrs: {
				to: '@s.whatsapp.net',
				type: 'set',
				xmlns: 'status',
			},
			content: [{
				tag: 'status',
				attrs: {},
				content: Buffer.from(status, 'utf-8')
			}]
		})
		return status
	}
	
	hirako.sendPoll = (jid, name = '', values = [], quoted, selectableCount = 1) => {
		return hirako.sendMessage(jid, { poll: { name, values, selectableCount }}, { quoted, ephemeralExpiration: quoted?.expiration || store?.messages[jid]?.array?.slice(-1)[0]?.metadata?.ephemeralDuration || 0 })
	}
	
	hirako.sendFileUrl = async (jid, url, caption, quoted, options = {}) => {
		const quotedOptions = { quoted, ephemeralExpiration: quoted?.expiration || store?.messages[jid]?.array?.slice(-1)[0]?.metadata?.ephemeralDuration || 0 }
		async function getFileUrl(res, mime) {
			if (mime && mime.includes('gif')) {
				return hirako.sendMessage(jid, { video: res.data, caption: caption, gifPlayback: true, ...options }, quotedOptions);
			} else if (mime && mime === 'application/pdf') {
				return hirako.sendMessage(jid, { document: res.data, mimetype: 'application/pdf', caption: caption, ...options }, quotedOptions);
			} else if (mime && mime.includes('image')) {
				return hirako.sendMessage(jid, { image: res.data, caption: caption, ...options }, quotedOptions);
			} else if (mime && mime.includes('video')) {
				return hirako.sendMessage(jid, { video: res.data, caption: caption, mimetype: 'video/mp4', ...options }, quotedOptions);
			} else if (mime && mime.includes('webp') && !/.jpg|.jpeg|.png/.test(url)) {
				return hirako.sendAsSticker(jid, res.data, quoted, options);
			} else if (mime && mime.includes('audio')) {
				return hirako.sendMessage(jid, { audio: res.data, mimetype: 'audio/mpeg', ...options }, quotedOptions);
			}
		}
		const axioss = axios.create({
			httpsAgent: new https.Agent({ rejectUnauthorized: false }),
		});
		const res = await axioss.get(url, { responseType: 'arraybuffer' });
		let mime = res.headers['content-type'];
		if (!mime || mime.includes('octet-stream')) {
			const fileType = await FileType.fromBuffer(res.data);
			mime = fileType ? fileType.mime : null;
		}
		const hasil = await getFileUrl(res, mime);
		return hasil
	}
	
	hirako.sendGroupInvite = async (jid, participant, inviteCode, inviteExpiration, groupName = 'Unknown Subject', caption = 'Invitation to join my WhatsApp group', jpegThumbnail = null, options = {}) => {
		const msg = proto.Message.fromObject({
			groupInviteMessage: {
				inviteCode,
				inviteExpiration: parseInt(inviteExpiration) || + new Date(new Date + (3 * 86400000)),
				groupJid: jid,
				groupName,
				jpegThumbnail: Buffer.isBuffer(jpegThumbnail) ? jpegThumbnail : null,
				caption,
				contextInfo: {
					mentionedJid: options.mentions || []
				}
			}
		});
		const message = generateWAMessageFromContent(participant, msg, options);
		const invite = await hirako.relayMessage(participant, message.message, { messageId: message.key.id })
		return invite
	}
	
	hirako.sendFromOwner = async (jid, text, quoted, options = {}) => {
		for (const a of jid) {
			await hirako.sendMessage(a.replace(/[^0-9]/g, '') + '@s.whatsapp.net', { text, ...options }, { quoted, ephemeralExpiration: quoted?.expiration || store?.messages[jid]?.array?.slice(-1)[0]?.metadata?.ephemeralDuration || 0 })
		}
	}
	
	hirako.sendText = async (jid, text, quoted, options = {}) => hirako.sendMessage(jid, { text: text, mentions: [...text.matchAll(/@(\d{0,16})/g)].map(v => v[1] + '@s.whatsapp.net'), ...options }, { quoted, ephemeralExpiration: quoted?.expiration || store?.messages[jid]?.array?.slice(-1)[0]?.metadata?.ephemeralDuration || 0 })
	
	hirako.sendAsSticker = async (jid, path, quoted, options = {}) => {
		const buff = Buffer.isBuffer(path) ? path : /^data:.*?\/.*?;base64,/i.test(path) ? Buffer.from(path.split`,`[1], 'base64') : /^https?:\/\//.test(path) ? await (await getBuffer(path)) : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0);
		const result = await writeExif(buff, options);
		return hirako.sendMessage(jid, { sticker: { url: result }, ...options }, { quoted, ephemeralExpiration: quoted?.expiration || store?.messages[jid]?.array?.slice(-1)[0]?.metadata?.ephemeralDuration || 0 });
	}
	
	hirako.downloadMediaMessage = async (message) => {
		const msg = message.msg || message;
		const mime = msg.mimetype || '';
		const messageType = (message.type || mime.split('/')[0]).replace(/Message/gi, '');
		const stream = await downloadContentFromMessage(msg, messageType);
		let buffer = Buffer.from([]);
		for await (const chunk of stream) {
			buffer = Buffer.concat([buffer, chunk]);
		}
		return buffer
	}
	
	hirako.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
		const buffer = await hirako.downloadMediaMessage(message);
		const type = await FileType.fromBuffer(buffer);
		const trueFileName = attachExtension ? `./database/sampah/${filename ? filename : Date.now()}.${type.ext}` : filename;
		await fs.promises.writeFile(trueFileName, buffer);
		return trueFileName;
	}
	
	hirako.getFile = async (PATH, save) => {
		let res;
		let filename;
		let data = Buffer.isBuffer(PATH) ? PATH : /^data:.*?\/.*?;base64,/i.test(PATH) ? Buffer.from(PATH.split`,`[1], 'base64') : /^https?:\/\//.test(PATH) ? await (res = await getBuffer(PATH)) : fs.existsSync(PATH) ? (filename = PATH, fs.readFileSync(PATH)) : typeof PATH === 'string' ? PATH : Buffer.alloc(0)
		let type = await FileType.fromBuffer(data) || { mime: 'application/octet-stream', ext: '.bin' }
		filename = path.join(__dirname, '../database/sampah/' + new Date * 1 + '.' + type.ext)
		if (data && save) fs.promises.writeFile(filename, data)
		return {
			res,
			filename,
			size: await getSizeMedia(data),
			...type,
			data
		}
	}
	
	hirako.appendResponseMessage = async (m, text) => {
		let apb = await generateWAMessage(m.chat, { text, mentions: m.mentionedJid }, { userJid: hirako.user.id, quoted: m.quoted });
		apb.key = m.key
		apb.key.fromMe = areJidsSameUser(m.sender, hirako.user.id);
		if (m.isGroup) apb.participant = m.sender;
		hirako.ev.emit('messages.upsert', {
			...m,
			messages: [proto.WebMessageInfo.fromObject(apb)],
			type: 'append'
		});
	}
	
	hirako.sendMedia = async (jid, path, fileName = '', caption = '', quoted = '', options = {}) => {
		const { mime, data, filename } = await hirako.getFile(path, true);
		const isWebpSticker = options.asSticker || /webp/.test(mime);
		let type = 'document', mimetype = mime, pathFile = filename;
		if (isWebpSticker) {
			pathFile = await writeExif(data, {
				packname: options.packname || global.packname,
				author: options.author || global.author,
				categories: options.categories || [],
			})
			await fs.unlinkSync(filename);
			type = 'sticker';
			mimetype = 'image/webp';
		} else if (/image|video|audio/.test(mime)) {
			type = mime.split('/')[0];
			mimetype = type == 'video' ? 'video/mp4' : type == 'audio' ? 'audio/mpeg' : mime
		}
		let anu = await hirako.sendMessage(jid, { [type]: { url: pathFile }, caption, mimetype, fileName, ...options }, { quoted, ephemeralExpiration: quoted?.expiration || store?.messages[jid]?.array?.slice(-1)[0]?.metadata?.ephemeralDuration || 0, ...options });
		await fs.unlinkSync(pathFile);
		return anu;
	}
	
	hirako.sendListMsg = async (jid, content = {}, options = {}) => {
		const { text, caption, footer = '', title, subtitle, ai, contextInfo = {}, buttons = [], mentions = [], ...media } = content;
		const msg = await generateWAMessageFromContent(jid, {
			viewOnceMessage: {
				message: {
					messageContextInfo: {
						deviceListMetadata: {},
						deviceListMetadataVersion: 2,
					},
					interactiveMessage: proto.Message.InteractiveMessage.create({
						body: proto.Message.InteractiveMessage.Body.create({ text: text || caption || '' }),
						footer: proto.Message.InteractiveMessage.Footer.create({ text: footer }),
						header: proto.Message.InteractiveMessage.Header.fromObject({
							title,
							subtitle,
							hasMediaAttachment: Object.keys(media).length > 0,
							...(media && typeof media === 'object' && Object.keys(media).length > 0 ? await generateWAMessageContent(media, {
								upload: hirako.waUploadToServer
							}) : {})
						}),
						nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
							buttons: buttons.map(a => {
								return {
									name: a.name,
									buttonParamsJson: JSON.stringify(a.buttonParamsJson ? (typeof a.buttonParamsJson === 'string' ? JSON.parse(a.buttonParamsJson) : a.buttonParamsJson) : '')
								}
							})
						}),
						contextInfo: {
							...contextInfo,
							...options.contextInfo,
							mentionedJid: options.mentions || mentions,
							...(options.quoted ? {
								stanzaId: options.quoted.key.id,
								remoteJid: options.quoted.key.remoteJid,
								participant: options.quoted.key.participant || options.quoted.key.remoteJid,
								fromMe: options.quoted.key.fromMe,
								quotedMessage: options.quoted.message
							} : {})
						}
					})
				}
			}
		}, {});
		const hasil = await hirako.relayMessage(msg.key.remoteJid, msg.message, {
			messageId: msg.key.id,
			additionalNodes: [{
				tag: 'biz',
				attrs: {},
				content: [{
					tag: 'interactive',
					attrs: {
						type: 'native_flow',
						v: '1'
					},
					content: [{
						tag: 'native_flow',
						attrs: {
							name: 'quick_reply'
						}
					}]
				}]
			}, ...(ai ? [{ attrs: { biz_bot: '1' }, tag: 'bot' }] : [])]
		})
		return hasil
	}
	
	hirako.sendButtonMsg = async (jid, content = {}, options = {}) => {
		const { text, caption, footer = '', headerType = 1, ai, contextInfo = {}, buttons = [], mentions = [], ...media } = content;
		const msg = await generateWAMessageFromContent(jid, {
			viewOnceMessage: {
				message: {
					messageContextInfo: {
						deviceListMetadata: {},
						deviceListMetadataVersion: 2,
					},
					buttonsMessage: {
						...(media && typeof media === 'object' && Object.keys(media).length > 0 ? await generateWAMessageContent(media, {
							upload: hirako.waUploadToServer
						}) : {}),
						contentText: text || caption || '',
						footerText: footer,
						buttons,
						headerType: media && Object.keys(media).length > 0 ? Math.max(...Object.keys(media).map((a) => ({ document: 3, image: 4, video: 5, location: 6 })[a] || headerType)) : headerType,
						contextInfo: {
							...contextInfo,
							...options.contextInfo,
							mentionedJid: options.mentions || mentions,
							...(options.quoted ? {
								stanzaId: options.quoted.key.id,
								remoteJid: options.quoted.key.remoteJid,
								participant: options.quoted.key.participant || options.quoted.key.remoteJid,
								fromMe: options.quoted.key.fromMe,
								quotedMessage: options.quoted.message
							} : {})
						}
					}
				}
			}
		}, {});
		const hasil = await hirako.relayMessage(msg.key.remoteJid, msg.message, {
			messageId: msg.key.id,
			additionalNodes: [{
				tag: 'biz',
				attrs: {},
				content: [{
					tag: 'interactive',
					attrs: {
						type: 'native_flow',
						v: '1'
					},
					content: [{
						tag: 'native_flow',
						attrs: {
							name: 'quick_reply'
						}
					}]
				}]
			}, ...(ai ? [{ attrs: { biz_bot: '1' }, tag: 'bot' }] : [])]
		})
		return hasil
	}
	
	hirako.newsletterMsg = async (key, content = {}, timeout = 5000) => {
		const { type: rawType = 'INFO', name, description = '', picture = null, react, id, newsletter_id = key, ...media } = content;
		const type = rawType.toUpperCase();
		if (react) {
			if (!(newsletter_id.endsWith('@newsletter') || !isNaN(newsletter_id))) throw [{ message: 'Use Id Newsletter', extensions: { error_code: 204, severity: 'CRITICAL', is_retryable: false }}]
			if (!id) throw [{ message: 'Use Id Newsletter Message', extensions: { error_code: 204, severity: 'CRITICAL', is_retryable: false }}]
			const hasil = await hirako.query({
				tag: 'message',
				attrs: {
					to: key,
					type: 'reaction',
					'server_id': id,
					id: generateMessageID()
				},
				content: [{
					tag: 'reaction',
					attrs: {
						code: react
					}
				}]
			});
			return hasil
		} else if (media && typeof media === 'object' && Object.keys(media).length > 0) {
			const msg = await generateWAMessageContent(media, { upload: hirako.waUploadToServer });
			const anu = await hirako.query({
				tag: 'message',
				attrs: { to: newsletter_id, type: 'text' in media ? 'text' : 'media' },
				content: [{
					tag: 'plaintext',
					attrs: /image|video|audio|sticker|poll/.test(Object.keys(media).join('|')) ? { mediatype: Object.keys(media).find(key => ['image', 'video', 'audio', 'sticker','poll'].includes(key)) || null } : {},
					content: proto.Message.encode(msg).finish()
				}]
			})
			return anu
		} else {
			if ((/(FOLLOW|UNFOLLOW|DELETE)/.test(type)) && !(newsletter_id.endsWith('@newsletter') || !isNaN(newsletter_id))) return [{ message: 'Use Id Newsletter', extensions: { error_code: 204, severity: 'CRITICAL', is_retryable: false }}]
			const _query = await hirako.query({
				tag: 'iq',
				attrs: {
					to: 's.whatsapp.net',
					type: 'get',
					xmlns: 'w:mex'
				},
				content: [{
					tag: 'query',
					attrs: {
						query_id: type == 'FOLLOW' ? '9926858900719341' : type == 'UNFOLLOW' ? '7238632346214362' : type == 'CREATE' ? '6234210096708695' : type == 'DELETE' ? '8316537688363079' : '6563316087068696'
					},
					content: new TextEncoder().encode(JSON.stringify({
						variables: /(FOLLOW|UNFOLLOW|DELETE)/.test(type) ? { newsletter_id } : type == 'CREATE' ? { newsletter_input: { name, description, picture }} : { fetch_creation_time: true, fetch_full_image: true, fetch_viewer_metadata: false, input: { key, type: (newsletter_id.endsWith('@newsletter') || !isNaN(newsletter_id)) ? 'JID' : 'INVITE' }}
					}))
				}]
			}, timeout);
			const res = JSON.parse(_query.content[0].content)?.data?.xwa2_newsletter || JSON.parse(_query.content[0].content)?.data?.xwa2_newsletter_join_v2 || JSON.parse(_query.content[0].content)?.data?.xwa2_newsletter_leave_v2 || JSON.parse(_query.content[0].content)?.data?.xwa2_newsletter_create || JSON.parse(_query.content[0].content)?.data?.xwa2_newsletter_delete_v2 || JSON.parse(_query.content[0].content)?.errors || JSON.parse(_query.content[0].content)
			res.thread_metadata ? (res.thread_metadata.host = 'https://mmg.whatsapp.net') : null
			return res
		}
	}
	
	hirako.sendCarouselMsg = async (jid, body = '', footer = '', cards = [], options = {}) => {
		async function getImageMsg(url) {
			const { imageMessage } = await generateWAMessageContent({ image: { url } }, { upload: hirako.waUploadToServer });
			return imageMessage;
		}
		const cardPromises = cards.map(async (a) => {
			const imageMessage = await getImageMsg(a.url);
			return {
				header: {
					imageMessage: imageMessage,
					hasMediaAttachment: true
				},
				body: { text: a.body },
				footer: { text: a.footer },
				nativeFlowMessage: {
					buttons: a.buttons.map(b => ({
						name: b.name,
						buttonParamsJson: JSON.stringify(b.buttonParamsJson ? JSON.parse(b.buttonParamsJson) : '')
					}))
				}
			};
		});
		
		const cardResults = await Promise.all(cardPromises);
		const msg = await generateWAMessageFromContent(jid, {
			viewOnceMessage: {
				message: {
					messageContextInfo: {
						deviceListMetadata: {},
						deviceListMetadataVersion: 2
					},
					interactiveMessage: proto.Message.InteractiveMessage.create({
						body: proto.Message.InteractiveMessage.Body.create({ text: body }),
						footer: proto.Message.InteractiveMessage.Footer.create({ text: footer }),
						carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.create({
							cards: cardResults,
							messageVersion: 1
						})
					})
				}
			}
		}, {});
		const hasil = await hirako.relayMessage(msg.key.remoteJid, msg.message, { messageId: msg.key.id });
		return hasil
	}
	
	if (hirako.user && hirako.user.id) {
		const botNumber = hirako.decodeJid(hirako.user.id);
		if (global.db?.set[botNumber]) {
			hirako.public = global.db.set[botNumber].public
		} else hirako.public = true
	} else hirako.public = true

	return hirako
}

/*
	* Create By hirako
	* Follow https://github.com/hirakodev
	* Whatsapp : https://whatsapp.com/channel/0029VaWOkNm7DAWtkvkJBK43
*/

async function Serialize(hirako, msg, store, groupCache) {
	const botLid = hirako.decodeJid(hirako.user.lid);
	const botNumber = hirako.decodeJid(hirako.user.id);
	const m = { ...msg };
	if (!m) return m
	if (m.key) {
		m.id = m.key.id
		m.chat = m.key.remoteJid
		m.fromMe = m.key.fromMe
		m.isBot = ['HSK', 'BAE', 'B1E', '3EB0', 'B24E', 'WA'].some(a => m.id.startsWith(a) && [12, 16, 20, 22, 40].includes(m.id.length)) || /(.)\1{5,}|[^a-zA-Z0-9]/.test(m.id) || false
		m.isGroup = m.chat.endsWith('@g.us')
		m.sender = hirako.decodeJid(m.fromMe && hirako.user.id || m.participant || m.key.participant || m.chat || '')
		if (m.isGroup) {
			if (!store.groupMetadata) store.groupMetadata = await hirako.groupFetchAllParticipating().catch(e => ({}));
			let metadata = store.groupMetadata[m.chat] ? store.groupMetadata[m.chat] : (store.groupMetadata[m.chat] = groupCache.get(m.chat))
			if (!metadata) {
				metadata = await hirako.groupMetadata(m.chat).catch(e => ({}))
				store.groupMetadata[m.chat] = metadata
				if (metadata) groupCache.set(m.chat, metadata)
			}
			m.metadata = metadata
			m.admins = m.metadata.participants ? (m.metadata.participants.reduce((a, b) => (b.admin ? a.push({ id: b.id, admin: b.admin }) : [...a]) && a, [])) : []
			m.isAdmin = m.admins?.some((b) => b.id === m.sender) || false
			m.participant = m.key.participant
			m.isBotAdmin = !!m.admins?.find((member) => [botNumber, botLid].includes(member.id)) || false
		}
	}
	if (m.message) {
		m.type = getContentType(m.message) || Object.keys(m.message)[0]
		m.msg = (/viewOnceMessage/i.test(m.type) ? m.message[m.type].message[getContentType(m.message[m.type].message)] : (extractMessageContent(m.message[m.type]) || m.message[m.type]))
		m.body = m.message?.conversation || m.msg?.text || m.msg?.conversation || m.msg?.caption || m.msg?.selectedButtonId || m.msg?.singleSelectReply?.selectedRowId || m.msg?.selectedId || m.msg?.contentText || m.msg?.selectedDisplayText || m.msg?.title || m.msg?.name || ''
		m.mentionedJid = m.msg?.contextInfo?.mentionedJid || []
		m.text = m.msg?.text || m.msg?.caption || m.message?.conversation || m.msg?.contentText || m.msg?.selectedDisplayText || m.msg?.title || '';
		m.prefix = /^[°•π÷×¶∆£¢€¥®™+✓_=|~!?@#$%^&.©^]/gi.test(m.body) ? m.body.match(/^[°•π÷×¶∆£¢€¥®™+✓_=|~!?@#$%^&.©^]/gi)[0] : /[\uD800-\uDBFF][\uDC00-\uDFFF]/gi.test(m.body) ? m.body.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/gi)[0] : ''
		m.command = m.body && m.body.replace(m.prefix, '').trim().split(/ +/).shift()
		m.args = m.body?.trim().replace(new RegExp("^" + m.prefix?.replace(/[.*=+:\-?^${}()|[\]\\]|\s/g, '\\$&'), 'i'), '').replace(m.command, '').split(/ +/).filter(a => a) || []
		m.device = getDevice(m.id)
		m.expiration = m.msg?.contextInfo?.expiration || 0
		m.timestamp = (typeof m.messageTimestamp === "number" ? m.messageTimestamp : m.messageTimestamp.low ? m.messageTimestamp.low : m.messageTimestamp.high) || m.msg.timestampMs * 1000
		m.isMedia = !!m.msg?.mimetype || !!m.msg?.thumbnailDirectPath
		if (m.isMedia) {
			m.mime = m.msg?.mimetype
			m.size = m.msg?.fileLength
			m.height = m.msg?.height || ''
			m.width = m.msg?.width || ''
			if (/webp/i.test(m.mime)) {
				m.isAnimated = m.msg?.isAnimated
			}
		}
		m.quoted = m.msg?.contextInfo?.quotedMessage || null
		if (m.quoted) {
			m.quoted.message = extractMessageContent(m.msg?.contextInfo?.quotedMessage)
			m.quoted.type = getContentType(m.quoted.message) || Object.keys(m.quoted.message)[0]
			m.quoted.id = m.msg.contextInfo.stanzaId
			m.quoted.device = getDevice(m.quoted.id)
			m.quoted.chat = m.msg.contextInfo.remoteJid || m.chat
			m.quoted.isBot = m.quoted.id ? ['HSK', 'BAE', 'B1E', '3EB0', 'B24E', 'WA'].some(a => m.quoted.id.startsWith(a) && [12, 16, 20, 22, 40].includes(m.quoted.id.length)) || /(.)\1{5,}|[^a-zA-Z0-9]/.test(m.quoted.id) : false
			m.quoted.sender = hirako.decodeJid(m.msg.contextInfo.participant)
			m.quoted.fromMe = m.quoted.sender === hirako.decodeJid(hirako.user.id)
			m.quoted.text = m.quoted.caption || m.quoted.conversation || m.quoted.contentText || m.quoted.selectedDisplayText || m.quoted.title || ''
			m.quoted.msg = extractMessageContent(m.quoted.message[m.quoted.type]) || m.quoted.message[m.quoted.type]
			m.quoted.mentionedJid = m.quoted?.msg?.contextInfo?.mentionedJid || []
			m.quoted.body = m.quoted.msg?.text || m.quoted.msg?.caption || m.quoted?.message?.conversation || m.quoted.msg?.selectedButtonId || m.quoted.msg?.singleSelectReply?.selectedRowId || m.quoted.msg?.selectedId || m.quoted.msg?.contentText || m.quoted.msg?.selectedDisplayText || m.quoted.msg?.title || m.quoted?.msg?.name || ''
			m.getQuotedObj = async () => {
				if (!m.quoted.id) return false
				let q = await store.loadMessage(m.chat, m.quoted.id, hirako)
				return await Serialize(hirako, q, store, groupCache)
			}
			m.quoted.key = {
				remoteJid: m.msg?.contextInfo?.remoteJid || m.chat,
				participant: m.quoted.sender,
				fromMe: areJidsSameUser(hirako.decodeJid(m.msg?.contextInfo?.participant), hirako.decodeJid(hirako?.user?.id)),
				id: m.msg?.contextInfo?.stanzaId
			}
			m.quoted.isGroup = m.quoted.chat.endsWith('@g.us')
			m.quoted.mentions = m.quoted.msg?.contextInfo?.mentionedJid || []
			m.quoted.body = m.quoted.msg?.text || m.quoted.msg?.caption || m.quoted?.message?.conversation || m.quoted.msg?.selectedButtonId || m.quoted.msg?.singleSelectReply?.selectedRowId || m.quoted.msg?.selectedId || m.quoted.msg?.contentText || m.quoted.msg?.selectedDisplayText || m.quoted.msg?.title || m.quoted?.msg?.name || ''
			m.quoted.prefix = /^[°•π÷×¶∆£¢€¥®™+✓_=|~!?@#$%^&.©^]/gi.test(m.quoted.body) ? m.quoted.body.match(/^[°•π÷×¶∆£¢€¥®™+✓_=|~!?@#$%^&.©^]/gi)[0] : /[\uD800-\uDBFF][\uDC00-\uDFFF]/gi.test(m.quoted.body) ? m.quoted.body.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/gi)[0] : ''
			m.quoted.command = m.quoted.body && m.quoted.body.replace(m.quoted.prefix, '').trim().split(/ +/).shift()
			m.quoted.isMedia = !!m.quoted.msg?.mimetype || !!m.quoted.msg?.thumbnailDirectPath
			if (m.quoted.isMedia) {
				m.quoted.mime = m.quoted.msg?.mimetype
				m.quoted.size = m.quoted.msg?.fileLength
				m.quoted.height = m.quoted.msg?.height || ''
				m.quoted.width = m.quoted.msg?.width || ''
				if (/webp/i.test(m.quoted.mime)) {
					m.quoted.isAnimated = m?.quoted?.msg?.isAnimated || false
				}
			}
			m.quoted.fakeObj = proto.WebMessageInfo.fromObject({
				key: {
					remoteJid: m.quoted.chat,
					fromMe: m.quoted.fromMe,
					id: m.quoted.id
				},
				message: m.quoted,
				...(m.isGroup ? { participant: m.quoted.sender } : {})
			})
			m.quoted.download = () => hirako.downloadMediaMessage(m.quoted)
			m.quoted.delete = () => {
				hirako.sendMessage(m.quoted.chat, {
					delete: {
						remoteJid: m.quoted.chat,
						fromMe: m.isBotAdmins ? false : true,
						id: m.quoted.id,
						participant: m.quoted.sender
					}
				})
			}
		}
	}
	
	m.download = () => hirako.downloadMediaMessage(m)
	
	m.copy = () => Serialize(hirako, proto.WebMessageInfo.fromObject(proto.WebMessageInfo.toObject(m)))
	
	m.react = (u) => hirako.sendMessage(m.chat, { react: { text: u, key: m.key }})
	
	m.reply = async (content, options = {}) => {
		const { quoted = m, chat = m.chat, caption = '', ephemeralExpiration = m.expiration || store?.messages[m.chat]?.array?.slice(-1)[0]?.metadata?.ephemeralDuration || 0, mentions = (typeof content === 'string' || typeof content.text === 'string' || typeof content.caption === 'string') ? [...(content.text || content.caption || content).matchAll(/@(\d{0,16})/g)].map(v => v[1] + '@s.whatsapp.net') : [], ...validate } = options;
		if (typeof content === 'object') {
			return hirako.sendMessage(chat, content, { ...options, quoted, ephemeralExpiration })
		} else if (typeof content === 'string') {
			try {
				if (/^https?:\/\//.test(content)) {
					const data = await axios.get(content, { responseType: 'arraybuffer' });
					const mime = data.headers['content-type'] || (await FileType.fromBuffer(data.data)).mime
					if (/gif|image|video|audio|pdf|stream/i.test(mime)) {
						return hirako.sendMedia(chat, data.data, '', caption, quoted, content)
					} else {
						return hirako.sendMessage(chat, { text: content, mentions, ...options }, { quoted, ephemeralExpiration })
					}
				} else {
					return hirako.sendMessage(chat, { text: content, mentions, ...options }, { quoted, ephemeralExpiration })
				}
			} catch (e) {
				return hirako.sendMessage(chat, { text: content, mentions, ...options }, { quoted, ephemeralExpiration })
			}
		}
	}

	return m
}

module.exports = { GroupUpdate, GroupParticipantsUpdate, LoadDataBase, MessagesUpsert, Solving }

let file = require.resolve(__filename)
fs.watchFile(file, () => {
	fs.unwatchFile(file)
	console.log(chalk.redBright(`Update ${__filename}`))
	delete require.cache[file]
	require(file)
});
