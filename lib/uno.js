const games = {};
const baseCardUrl = "https://raw.githubusercontent.com/john-costanzo/uno-card-images/master/";

function createCardUrl(card) {
  return card.startsWith("Wild") ? baseCardUrl + `Wild.png` : baseCardUrl + `${card}.png`;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getRandomCard() {
  const colors = ['Red', 'Green', 'Blue', 'Yellow'];
  const values = ['0','1','2','3','4','5','6','7','8','9','Skip','Reverse','Draw_2'];
  const specials = ['Wild', 'Wild_Draw_4'];
  const all = [];
  for (const c of colors) {
    for (const v of values) {
      all.push(`${c}_${v}`);
    }
  }
  return all.concat(specials)[Math.floor(Math.random() * all.length)];
}

function drawCard(game) {
  if (game.deck.length === 0) {
    const top = game.discard.pop();
    game.deck = shuffle(game.discard);
    game.discard = [top];
  }
  return game.deck.pop();
}

function matchCard(card, topCard, currentColor) {
  if (card.startsWith('Wild')) return true;
  const [c1, v1] = card.split('_');
  const [c2, v2] = topCard.split('_');
  return c1 === currentColor || v1 === v2;
}

// ✅ Kirim kartu + tombol pakai sendButtonMsg (SINKRON DM ⇆ GRUP)
async function sendPlayerCards(hirako, player, hand, currentTurn) {
  if (hand.length === 0) {
    await hirako.sendMessage(player, { text: `✅ Kartu kamu habis, kamu menang!` });
    return;
  }

  const teks = `🃏 *Kartu Kamu:*\n${hand.map(c => `• ${c}`).join('\n')}\n\nGiliran: @${currentTurn.split('@')[0]}`;

  // 1) Gambar
  await hirako.sendMessage(player, {
    image: { url: createCardUrl(hand[0]) },
    caption: "🃏 Kartu Atas Kamu"
  });

  // 2) Button pakai sendButtonMsg
  await hirako.sendButtonMsg(player, {
    text: teks,
    footer: 'Playing Uno ©hirako',
    mentions: [currentTurn],
    buttons: [
      ...hand.slice(0, 5).map(card => ({
        buttonId: `.uno play ${card}`,
        buttonText: { displayText: `▶️ ${card}` },
        type: 1
      })),
      {
        buttonId: `.uno draw`,
        buttonText: { displayText: '🃏 Draw' },
        type: 1
      },
      {
        buttonId: `.uno skip`,
        buttonText: { displayText: '⏭️ Skip' },
        type: 1
      },
      {
        buttonId: `.uno end`,
        buttonText: { displayText: '❌ End Game' },
        type: 1
      },
      {
        buttonId: `.uno status`,
        buttonText: { displayText: '📊 UNO Status' },
        type: 1
      }
    ]
  });
}

exports.unoHandler = async (hirako, m, args, db) => {
  const command = (args[0] || '').toLowerCase();

  // ✅ ID ROOM SELALU DARI GRUP — kalau di DM: cari room aktif
  let chatId = m.isGroup ? m.chat : null;
  let game = chatId ? games[chatId] : null;

  // Kalau di DM ➜ cari room yang punya player ini
  if (!m.isGroup) {
    const found = Object.entries(games).find(([_, g]) => g.players.includes(m.sender));
    if (found) {
      [chatId, game] = found;
    }
  }

  // === CREATE ===
  if (command === 'create') {
    if (!m.isGroup) return m.reply('Hanya bisa membuat room di grup!');
    if (games[m.chat]) return m.reply('Room sudah ada! Gunakan .uno join');
    games[m.chat] = {
      players: [],
      started: false,
      turn: 0,
      deck: [],
      hands: {},
      discard: [],
      drawStack: 0,
      currentColor: null,
    };
    return m.reply('✅ Room UNO dibuat! Gunakan .uno join untuk bergabung.');
  }

  if (!game) return m.reply('Belum ada room UNO! Buat dulu pakai: .uno create (di grup).');

  // === JOIN ===
  if (command === 'join') {
    if (game.players.includes(m.sender)) return m.reply('Kamu sudah join!');
    if (game.players.length >= 2) return m.reply('Room penuh, hanya 2 pemain!');
    game.players.push(m.sender);
    m.reply(`✅ @${m.sender.split('@')[0]} join UNO!`, { mentions: [m.sender] });
  }

  // === START ===
  else if (command === 'start') {
    if (game.players.length < 2) return m.reply('Butuh 2 pemain!');
    if (game.started) return m.reply('Game sudah dimulai.');
    game.started = true;
    game.deck = Array.from({ length: 80 }, () => getRandomCard());
    for (const p of game.players) {
      game.hands[p] = [];
      for (let i = 0; i < 7; i++) game.hands[p].push(drawCard(game));
    }
    let firstCard;
    do { firstCard = drawCard(game); } while (firstCard.includes('Wild'));
    game.discard.push(firstCard);
    game.currentColor = firstCard.split('_')[0];

    await hirako.sendMessage(chatId, {
      image: { url: createCardUrl(firstCard) },
      caption: `🎮 Game dimulai!\nKartu awal: ${firstCard}\n\nGiliran @${game.players[game.turn].split('@')[0]}`,
      mentions: game.players
    });

    for (const p of game.players) {
      await sendPlayerCards(hirako, p, game.hands[p], game.players[game.turn]);
    }
  }

  // === DRAW ===
  else if (command === 'draw') {
    if (!game.started) return m.reply('Game belum dimulai.');
    const player = m.sender;
    if (player !== game.players[game.turn]) return m.reply('Bukan giliranmu!');
    const drawAmount = game.drawStack || 1;
    for (let i = 0; i < drawAmount; i++) {
      const card = drawCard(game);
      game.hands[player].push(card);
    }

    await hirako.sendMessage(chatId, {
      text: `✅ @${player.split('@')[0]} menarik ${drawAmount} kartu.`,
      mentions: [player]
    });

    await sendPlayerCards(hirako, player, game.hands[player], game.players[game.turn]);

    game.drawStack = 0;
    game.turn = (game.turn + 1) % 2;

    const opponent = game.players[game.turn];
    m.reply(`🃏 Giliran @${opponent.split('@')[0]}\nJumlah kartu lawan: ${game.hands[opponent].length}\nWarna aktif: ${game.currentColor}`, { mentions: [opponent] });
  }

  // === SKIP ===
  else if (command === 'skip') {
    if (!game.started) return m.reply('Game belum dimulai.');
    if (m.sender !== game.players[game.turn]) return m.reply('Bukan giliranmu!');
    game.turn = (game.turn + 1) % 2;
    m.reply(`⏭️ Lewat! Sekarang giliran @${game.players[game.turn].split('@')[0]}`, { mentions: [game.players[game.turn]] });
  }

  // === END ===
  else if (command === 'end') {
    delete games[chatId];
    m.reply('❌ Room & Game UNO dihapus.');
  }

  // === STATUS ===
  else if (command === 'status') {
    if (!game.started) return m.reply('Game belum dimulai.');
    let status = `🃏 Kartu di atas: ${game.discard[game.discard.length - 1]}\nWarna aktif: ${game.currentColor}\n\n`;
    for (const p of game.players) {
      status += `👤 @${p.split('@')[0]}: ${game.hands[p].length} kartu\n`;
    }
    status += `\nGiliran: @${game.players[game.turn].split('@')[0]}`;
    m.reply(status, { mentions: game.players });
  }

  // === PLAY ===
  else if (command === 'play') {
    const card = args[1];
    if (!card) return m.reply('Gunakan: .uno play Red_9 atau Wild_Draw_Four');
    if (!game.started) return m.reply('Game belum dimulai!');
    if (m.sender !== game.players[game.turn]) return m.reply('Bukan giliranmu!');
    const hand = game.hands[m.sender];
    if (!hand.includes(card)) return m.reply('Kartu itu tidak ada di tanganmu!');
    const topCard = game.discard[game.discard.length - 1];
    if (!matchCard(card, topCard, game.currentColor)) return m.reply(`Kartu tidak cocok! Kartu atas: ${topCard} | Warna aktif: ${game.currentColor}`);

    hand.splice(hand.indexOf(card), 1);
    game.discard.push(card);
    if (card.startsWith('Wild')) {
      game.currentColor = null;
    } else {
      game.currentColor = card.split('_')[0];
    }

    await hirako.sendMessage(chatId, {
      image: { url: createCardUrl(card) },
      caption: `✅ @${m.sender.split('@')[0]} mainkan: ${card}`,
      mentions: [m.sender]
    });

    if (hand.length === 0) {
      m.reply(`🎉 @${m.sender.split('@')[0]} MENANG!`, { mentions: [m.sender] });
      delete games[chatId];
      return;
    }

    await sendPlayerCards(hirako, m.sender, hand, game.players[game.turn]);

    if (card.endsWith('Skip')) {
      game.turn = (game.turn + 2) % 2;
      m.reply(`⏭️ Pemain berikut dilewati!`);
    } else if (card.endsWith('Reverse')) {
      game.players.reverse();
      game.turn = 1 - game.turn;
      m.reply(`🔁 Urutan dibalik!`);
    } else if (card.endsWith('Draw_Two')) {
      game.drawStack = 2;
      game.turn = (game.turn + 1) % 2;
    } else if (card.includes('Wild_Draw_Four')) {
      game.drawStack = 4;
      game.turn = (game.turn + 1) % 2;
    } else {
      game.turn = (game.turn + 1) % 2;
    }

    if (card.startsWith('Wild')) {
      hirako.sendMessage(m.sender, { text: `🎨 Pilih warna: .uno changecolor Red/Blue/Green/Yellow` });
      return;
    }

    const opponent = game.players[game.turn];
    m.reply(`🃏 Giliran @${opponent.split('@')[0]}\nJumlah kartu lawan: ${game.hands[opponent].length}\nWarna aktif: ${game.currentColor}`, { mentions: [opponent] });
  }

  // === CHANGE COLOR ===
  else if (command === 'changecolor') {
    const color = (args[1] || '').toLowerCase();
    if (!['red','green','blue','yellow'].includes(color)) return m.reply('Pilih warna: Red, Green, Blue, Yellow.');
    if (!game.discard[game.discard.length - 1].startsWith('Wild')) return m.reply('Hanya bisa ubah warna jika kartu atas Wild!');
    game.currentColor = color.charAt(0).toUpperCase() + color.slice(1);
    m.reply(`✅ Warna diubah ke ${game.currentColor}`);
    const opponent = game.players[game.turn];
    m.reply(`🃏 Giliran @${opponent.split('@')[0]} | Warna aktif: ${game.currentColor}`, { mentions: [opponent] });
  }

  // === DEFAULT ===
  else {
    const hand = game.hands[m.sender];
    if (!hand) return m.reply('Kamu belum join!');
    await sendPlayerCards(hirako, m.sender, hand, game.players[game.turn]);
  }
};