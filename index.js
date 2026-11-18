import 'dotenv/config';
import fs from 'node:fs';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} from 'discord.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// Almacena las partidas activas por canal y las cartas ya usadas en la sesión
const partidasActivas = new Map();
const cartasUsadasSesion = new Set();

function cargarCartas() {
  const raw = fs.readFileSync('./cartas.json', 'utf-8');
  return JSON.parse(raw);
}

function guardarCartas(cartas) {
  fs.writeFileSync('./cartas.json', JSON.stringify(cartas, null, 2), 'utf-8');
}

function barajar(array) {
  const copia = [...array];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

const comandos = [
  new SlashCommandBuilder()
    .setName('quien-soy')
    .setDescription('Inicia una sala de ¿Quién soy? Futbolero en este canal.'),
  new SlashCommandBuilder()
    .setName('agregar-carta')
    .setDescription('Agrega un jugador, club o carta troll al mazo sin que nadie la vea.')
    .addStringOption(option =>
      option
        .setName('nombre')
        .setDescription('Ej: Neymar Jr, O el carrito camillero que se queda sin batería')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('categoria')
        .setDescription('Tipo de carta')
        .setRequired(true)
        .addChoices(
          { name: 'Jugador / DT', value: 'Jugador' },
          { name: 'Club / Selección', value: 'Club' },
          { name: 'Carta Troll', value: 'Troll' }
        )
    )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function registrarComandos() {
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: comandos }
    );
    console.log('✅ Comandos Slash registrados correctamente.');
  } catch (error) {
    console.error('❌ Error registrando comandos:', error);
  }
}

client.once('ready', async () => {
  console.log(`⚽ Bot conectado como ${client.user.tag}`);
  await registrarComandos();
});

// Embed de la fase de Lobby
function crearEmbedLobby(partida) {
  const listaTexto =
    partida.jugadores.size > 0
      ? Array.from(partida.jugadores.values())
          .map((j, i) => `${i + 1}. <@${j.id}>`)
          .join('\n')
      : '*Nadie se ha unido todavía...*';

  return new EmbedBuilder()
    .setColor(0x00b894)
    .setTitle('⚽ ¿Quién soy? Futbolero — Sala Abierta')
    .setDescription(
      `Anfitrión: <@${partida.creadorId}>\n` +
      'Únanse a la partida. Cuando estén todos listos, el anfitrión presiona **Repartir tarjetas**.\n\n' +
      `**Jugadores inscritos (${partida.jugadores.size}):**\n${listaTexto}`
    )
    .setFooter({ text: 'Tip: Usa /agregar-carta para meter cartas troll secretas antes de empezar' });
}

// Embed dinámico de la fase de Juego Activo (con orden de turnos y podio)
function crearEmbedJuego(partida) {
  const listaTurnos = partida.ordenTurnos
    .map((userId, index) => {
      const posicionPodio = partida.ganadores.indexOf(userId);
      const estado =
        posicionPodio !== -1
          ? `🏆 **#${posicionPodio + 1} ¡Adivinó!**`
          : '❓ *Adivinando...*';
      return `**Turno ${index + 1}:** <@${userId}> — ${estado}`;
    })
    .join('\n');

  return new EmbedBuilder()
    .setColor(0xfdcb6e)
    .setTitle('🃏 ¡Tarjetas pegadas en la frente!')
    .setDescription(
      '• Presiona **Ver tarjetas** para ver qué tienen los demás (la tuya saldrá oculta).\n' +
      '• Cuando descubras quién eres, presiona **¡Ya adiviné!** para asegurar tu puesto sin cortar la ronda.\n\n' +
      `**Orden de preguntas y estado:**\n${listaTurnos}`
    )
    .setFooter({ text: `Solo el anfitrión puede finalizar y revelar todo el tablero` });
}

function crearBotonesLobby() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('qs_unirse')
      .setLabel('Unirme / Salir')
      .setEmoji('🙋‍♂️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('qs_repartir')
      .setLabel('Repartir tarjetas')
      .setEmoji('🃏')
      .setStyle(ButtonStyle.Success)
  );
}

function crearBotonesJuego() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('qs_ver_cartas')
      .setLabel('Ver tarjetas')
      .setEmoji('👀')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('qs_adivine')
      .setLabel('¡Ya adiviné!')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('qs_revelar')
      .setLabel('Revelar todo')
      .setEmoji('🏁')
      .setStyle(ButtonStyle.Danger)
  );
}

client.on('interactionCreate', async interaction => {
  // 1. COMANDOS SLASH
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'agregar-carta') {
      const nombre = interaction.options.getString('nombre').trim();
      const categoria = interaction.options.getString('categoria');
      const cartas = cargarCartas();

      const existe = cartas.some(c => c.nombre.toLowerCase() === nombre.toLowerCase());
      if (existe) {
        return interaction.reply({
          content: `⚠️ La carta **${nombre}** ya existe en el mazo.`,
          flags: MessageFlags.Ephemeral
        });
      }

      cartas.push({ nombre, categoria });
      guardarCartas(cartas);

      return interaction.reply({
        content: `🤫 Carta añadida en secreto al mazo (**${categoria}**): **${nombre}**. Total: ${cartas.length}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (interaction.commandName === 'quien-soy') {
      if (partidasActivas.has(interaction.channelId)) {
        return interaction.reply({
          content: '⚠️ Ya hay una sala activa en este canal. Finalízala antes de abrir una nueva.',
          flags: MessageFlags.Ephemeral
        });
      }

      const jugadores = new Map();
      jugadores.set(interaction.user.id, {
        id: interaction.user.id,
        username: interaction.user.displayName
      });

      const nuevaPartida = {
        estado: 'LOBBY',
        creadorId: interaction.user.id,
        jugadores,
        ordenTurnos: [],
        asignaciones: new Map(),
        ganadores: []
      };

      partidasActivas.set(interaction.channelId, nuevaPartida);

      return interaction.reply({
        embeds: [crearEmbedLobby(nuevaPartida)],
        components: [crearBotonesLobby()]
      });
    }
  }

  // 2. BOTONES
  if (interaction.isButton()) {
    const partida = partidasActivas.get(interaction.channelId);

    if (!partida) {
      return interaction.reply({
        content: '❌ Esta partida ya expiró o fue finalizada. Inicia una nueva con `/quien-soy`.',
        flags: MessageFlags.Ephemeral
      });
    }

    // UNIRSE / SALIR
    if (interaction.customId === 'qs_unirse') {
      if (partida.estado !== 'LOBBY') {
        return interaction.reply({
          content: '⚠️ La partida ya empezó. Espera a la siguiente ronda.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (partida.jugadores.has(interaction.user.id)) {
        partida.jugadores.delete(interaction.user.id);
      } else {
        partida.jugadores.set(interaction.user.id, {
          id: interaction.user.id,
          username: interaction.user.displayName
        });
      }

      return interaction.update({
        embeds: [crearEmbedLobby(partida)],
        components: [crearBotonesLobby()]
      });
    }

    // REPARTIR TARJETAS (SOLO ANFITRIÓN)
    if (interaction.customId === 'qs_repartir') {
      if (interaction.user.id !== partida.creadorId) {
        return interaction.reply({
          content: `⚠️ Solo el anfitrión (<@${partida.creadorId}>) puede iniciar el reparto.`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (partida.jugadores.size < 2) {
        return interaction.reply({
          content: '⚠️ Se necesitan al menos **2 jugadores** para empezar.',
          flags: MessageFlags.Ephemeral
        });
      }

      const mazoCompleto = cargarCartas();
      if (mazoCompleto.length < partida.jugadores.size) {
        return interaction.reply({
          content: `⚠️ No hay suficientes cartas en \`cartas.json\` para ${partida.jugadores.size} jugadores.`,
          flags: MessageFlags.Ephemeral
        });
      }

      // Filtrar cartas ya usadas en rondas anteriores; si quedan pocas, reiniciar historial
      let disponibles = mazoCompleto.filter(c => !cartasUsadasSesion.has(c.nombre));
      if (disponibles.length < partida.jugadores.size) {
        cartasUsadasSesion.clear();
        disponibles = mazoCompleto;
      }

      const cartasBarajadas = barajar(disponibles);
      partida.asignaciones.clear();
      partida.ganadores = [];

      let indice = 0;
      for (const [userId, datosJugador] of partida.jugadores.entries()) {
        const cartaElegida = cartasBarajadas[indice];
        cartasUsadasSesion.add(cartaElegida.nombre);
        partida.asignaciones.set(userId, {
          jugador: datosJugador,
          carta: cartaElegida
        });
        indice++;
      }

      // Sortear orden de turnos aleatorio
      partida.ordenTurnos = barajar(Array.from(partida.jugadores.keys()));
      partida.estado = 'JUGANDO';

      return interaction.update({
        embeds: [crearEmbedJuego(partida)],
        components: [crearBotonesJuego()]
      });
    }

    // VER TARJETAS (EFÍMERO PRIVADO)
    if (interaction.customId === 'qs_ver_cartas') {
      if (!partida.asignaciones.has(interaction.user.id)) {
        return interaction.reply({
          content:
            '👀 **Modo Espectador** (no estás jugando esta ronda, puedes ver todas):\n\n' +
            Array.from(partida.asignaciones.values())
              .map(a => `• **${a.jugador.username}**: \`[${a.carta.categoria}]\` **${a.carta.nombre}**`)
              .join('\n'),
          flags: MessageFlags.Ephemeral
        });
      }

      const yaAdivino = partida.ganadores.includes(interaction.user.id);
      const lineas = [];

      for (const [userId, info] of partida.asignaciones.entries()) {
        if (userId === interaction.user.id && !yaAdivino) {
          lineas.push(`🙈 **${info.jugador.username} (TÚ):** ||❓ TARJETA OCULTA — ¡Adivínala!||`);
        } else if (userId === interaction.user.id && yaAdivino) {
          lineas.push(`🏆 **${info.jugador.username} (TÚ — Ya adivinaste):** \`[${info.carta.categoria}]\` **${info.carta.nombre}**`);
        } else {
          lineas.push(`👤 **${info.jugador.username}:** \`[${info.carta.categoria}]\` **${info.carta.nombre}**`);
        }
      }

      return interaction.reply({
        content: `### 📋 Tarjetas de la ronda (Solo tú ves este mensaje)\n\n${lineas.join('\n')}`,
        flags: MessageFlags.Ephemeral
      });
    }

    // ¡YA ADIVINÉ! (REGISTRA EN EL PODIO Y REVELA EN PRIVADO AL JUGADOR)
    if (interaction.customId === 'qs_adivine') {
      if (!partida.asignaciones.has(interaction.user.id)) {
        return interaction.reply({
          content: '⚠️ No estás participando como jugador en esta ronda.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (partida.ganadores.includes(interaction.user.id)) {
        const miInfo = partida.asignaciones.get(interaction.user.id);
        return interaction.reply({
          content: `✅ Ya habías asegurado tu puesto. Tu tarjeta era: \`[${miInfo.carta.categoria}]\` **${miInfo.carta.nombre}**`,
          flags: MessageFlags.Ephemeral
        });
      }

      partida.ganadores.push(interaction.user.id);
      const miInfo = partida.asignaciones.get(interaction.user.id);
      const puesto = partida.ganadores.length;

      // Actualizar el tablero público con el nuevo puesto en el podio
      await interaction.update({
        embeds: [crearEmbedJuego(partida)],
        components: [crearBotonesJuego()]
      });

      // Enviar confirmación privada al jugador con su tarjeta
      return interaction.followUp({
        content: `🏆 **¡Puesto #${puesto} asegurado!** Tu tarjeta era: \`[${miInfo.carta.categoria}]\` **${miInfo.carta.nombre}**.\n*(Guarda el secreto para los que aún siguen adivinando).*`,
        flags: MessageFlags.Ephemeral
      });
    }

    // REVELAR TODO Y TERMINAR (SOLO ANFITRIÓN)
    if (interaction.customId === 'qs_revelar') {
      if (interaction.user.id !== partida.creadorId) {
        return interaction.reply({
          content: `⚠️ Solo el anfitrión (<@${partida.creadorId}>) puede terminar la ronda y revelar todas las tarjetas.`,
          flags: MessageFlags.Ephemeral
        });
      }

      const resumenFinal = partida.ordenTurnos
        .map(userId => {
          const info = partida.asignaciones.get(userId);
          const pos = partida.ganadores.indexOf(userId);
          const medalla = pos !== -1 ? `🏆 #${pos + 1}` : '❌ No adivinó';
          return `• <@${userId}> (${medalla}) → \`[${info.carta.categoria}]\` **${info.carta.nombre}**`;
        })
        .join('\n');

      partidasActivas.delete(interaction.channelId);

      const embedFinal = new EmbedBuilder()
        .setColor(0xd63031)
        .setTitle('🏁 Ronda finalizada — Revelación de tarjetas')
        .setDescription(`${resumenFinal}\n\n*Usa \`/quien-soy\` para iniciar otra ronda.*`);

      return interaction.update({
        embeds: [embedFinal],
        components: []
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);