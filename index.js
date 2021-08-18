const Discord = ({ Client, Intents } = require("discord.js"));

const intents = new Discord.Intents(32767);
const bot = new Client({ intents });
const { prefix, token, mongoPath } = require("./jsonFiles/config.json");
const mongoose = require("mongoose");
const mongo = require("./utility/mongo.js");
const welcome = require("./commands/configuration/welcome");
const guildSchema = require("./schemas/guildSchema");
const fs = require("fs");
const Levels = require("discord-xp");
const joinCache = {};
const leaveCache = {};

bot.login(token);

bot.commands = new Discord.Collection();
bot.cooldowns = new Discord.Collection();

const commandFolders = fs.readdirSync("./commands");

for (const folder of commandFolders) {
	//Finds the name of the command
	const commandFiles = fs
		.readdirSync(`./commands/${folder}`)
		.filter((file) => file.endsWith(".js"));
	for (const file of commandFiles) {
		const command = require(`./commands/${folder}/${file}`);
		bot.commands.set(command.name, command);
	}
}

bot.on("guildMemberAdd", async (member) => {
	const { guild, user } = member;

	const guildId = guild.id;

	let data = joinCache[guild.id];

	/* const validationJoinCache = welcome.validationJoinCache || data;

	const validation = validationJoinCache[guild.id]; */

	/* 	const validation = !welcome.validationJoinCache[guild.id]
		? data
		: welcome.validationJoinCache[guild.id]; */

	if (data !== validation) {
		await mongo().then(async (mongoose) => {
			try {
				const result = await guildSchema.findOne({ guildId });

				console.log("I got here!");

				joinCache[guild.id] = data = !result ? "non existent" : [result.channelId, result.message];
			} finally {
				mongoose.connection.close();
			}
		});
	}

	if (data === "non existent") return;

	const embed = new Discord.MessageEmbed()
		.setTitle(`\`${user.username}#${user.discriminator}\` just joined \`${guild.name}\``)
		.setColor("#00FF00")
		.setDescription(`${data[1]}`)
		.setFooter(user.avatarURL())
		.setTimestamp(new Date());

	bot.channels.cache
		.get(data[0])
		.send(member, embed)
		.then((message) => {
			message.edit("", embed);
		});
});

bot.on("guildMemberRemove", async (member) => {
	const { guild, user } = member;

	const guildId = guild.id;

	let data = leaveCache[guild.id];

	if (!data) {
		await mongo().then(async (mongoose) => {
			try {
				const result = await guildSchema.findOne({ guildId });

				leaveCache[guild.id] = data = !result
					? "non existent"
					: [result.channelId, result.leaveMessage];
			} finally {
				mongoose.connection.close();
			}
		});
	}

	if (data === "non existent") return;

	const embed = new Discord.MessageEmbed()
		.setTitle(`\`${user.username}#${user.discriminator}\` just left \`${guild.name}\``)
		.setColor("#DC143C")
		.setDescription(`${data[1]}`)
		.setFooter(user.avatarURL())
		.setTimestamp(new Date());

	bot.channels.cache
		.get(data[0])
		.send(member, embed)
		.then((message) => {
			message.edit("", embed);
		});
});

bot.on("ready", async () => {
	console.log("Connect as " + bot.user.tag);
	//levels(bot);

	await mongo().then(() => {
		try {
			console.log("Connected to mongo!");
		} finally {
			mongoose.connection.close();
		}
	});

	bot.user.setActivity(".help", {
		type: "WATCHING",
	});
});

bot.on("message", async (message) => {
	try {
		await mongo().then(async (mongoose) => {
			Levels.setURL(mongoPath);

			if (!message.guild) return;
			if (message.author.bot) return;

			const randomAmountOfXp = Math.floor(Math.random() * 20) + 1; // Min 1, Max 30
			const hasLeveledUp = await Levels.appendXp(
				message.author.id,
				message.guild.id,
				randomAmountOfXp
			);
			if (hasLeveledUp) {
				const user = await Levels.fetch(message.author.id, message.guild.id);
				message.channel.send(
					`${message.author}, congratulations! You have leveled up to **${user.level}** in \`${message.guild.name}\` :sunglasses:`
				);
			}
		});

		if (!message.content.startsWith(prefix) || message.author.bot) return;

		const args = message.content.slice(prefix.length).trim().split(/ +/);
		const commandName = args.shift().toLowerCase();

		const command =
			bot.commands.get(commandName) ||
			bot.commands.find((cmd) => cmd.aliases && cmd.aliases.includes(commandName));

		if (!command) return;

		if (command.guildOnly && message.channel.type === "dm")
			return message.reply("I can't execute that command inside DMs!");

		if (command.permissions) {
			const authorPerms = message.channel.permissionsFor(message.author);
			if (!authorPerms || !authorPerms.has(command.permissions)) {
				if (message.author.id !== "344834268742156298") {
					return message.reply("YOU DO NOT HAVE PERMISSION (git gud scrub)");
				}
			}
		}

		if (command.creator === true && message.author.id !== "344834268742156298")
			return message.reply("Wait what, you are not creator man, you cannot use the command!!!!!");

		if (command.args === true && !args.length) {
			let reply = `You didn't provide a valid arguments, ${message.author}!`;

			if (command.usage) {
				reply += `\nThe proper usage would be: \`${prefix}${command.name} ${command.usage}\``;
			}
			message.delete({
				timeout: 25 * 1000,
			});
			return message.channel.send(reply).then((message) => {
				message.delete({
					timeout: 25 * 1000,
				});
			});
		}

		const { cooldowns } = bot;

		if (!cooldowns.has(command.name)) {
			cooldowns.set(command.name, new Discord.Collection());
		}

		const now = Date.now();
		const timestamps = cooldowns.get(command.name);
		const cooldownAmount = (command.cooldown ?? 1.5) * 1000;

		if (timestamps.has(message.author.id)) {
			const expirationTime = timestamps.get(message.author.id) + cooldownAmount;

			if (now < expirationTime) {
				const timeLeft = (expirationTime - now) / 1000;
				return message.reply(
					`please wait ${timeLeft.toFixed(1)} more second(s) before reusing the \`${
						command.name
					}\` command.`
				);
			}
		}

		timestamps.set(message.author.id, now);
		setTimeout(() => timestamps.delete(message.author.id), cooldownAmount);

		const maxArguments = command.maxArgs || null;

		if (
			args.length < command.minArgs ||
			(maxArguments !== null && command.args === "true" && args.length > command.maxArgs)
		) {
			let reply = `\nThe proper usage would be: \`${prefix}${command.name} ${command.usage}\``;
			return message.channel.send(reply);
		}

		try {
			command.execute(message, args, message.guild);
		} catch (err) {
			console.log(err);
		}
	} catch (err) {
		console.log(err);
	}
});
