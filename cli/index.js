#!/usr/bin/env node
/* eslint-disable */
const args = require('minimist')(process.argv.slice(2));
const fs = require('fs');

const chalk = require('chalk');

const Packet = require('../lib/packet');
const Device = require('../lib/device');
const { Browser } = require('../lib/discovery');
const Tokens = require('../lib/tokens');
const models = require('../lib/models');

const tokens = new Tokens();

function info() {
	console.log(chalk.bgWhite.black(' INFO '), Array.prototype.join.call(arguments, ' '));
}

function error() {
	console.log(chalk.bgRed.white(' ERROR '), Array.prototype.join.call(arguments, ' '));
}

function warn() {
	console.log(chalk.bgYellow.black(' WARNING '), Array.prototype.join.call(arguments, ' '));
}

function log() {
	console.log.apply(console, arguments);
}

if(args.discover) {
	info('Discovering devices. Press Ctrl+C to stop.')
	log();
	const browser = new Browser({
		cacheTime: 60,
		useTokenStorage: true
	});
	browser.on('available', reg => {
		const supported = reg.model && reg.type;
		log(chalk.bold('Device ID:'), reg.id);
		log(chalk.bold('Model info:'), reg.model || 'Unknown', reg.type ? chalk.dim('(' + reg.type + ')') : '');
		log(chalk.bold('Address:'), reg.address, (reg.hostname ? chalk.dim('(' + reg.hostname + ')') : ''));
		if(reg.token) {
			log(chalk.bold('Token:'), reg.token, reg.autoToken ? chalk.green('via auto-token') : chalk.yellow('via stored token'));
		} else {
			log(chalk.bold('Token:'), '???')
		}
		log(chalk.bold('Support:'), reg.model ? (supported ? chalk.green('At least basic') : chalk.yellow('Generic')) : chalk.yellow('Unknown'));
		log();

		if(args.sync && reg.token && reg.autoToken) {
			tokens.update(reg.id, reg.token)
				.catch(err => {
					error('Could not update token for', reg.id, ':', err);
				});
		}
	});
} else if(args.configure) {
	const ssid = args.ssid;
	const passwd = args.passwd;

	if(typeof ssid === 'undefined') {
		error('--ssid must be used and set to name of the wireless network the device should connect to');
		process.exit(1);
	}
	if(typeof passwd === 'undefined') {
		error('--passwd must be used and set to password of the wireless network');
		process.exit(1);
	}

	let target = null;
	if(typeof args.configure !== 'boolean') {
		// We want a specific address or id
		target = String(args.configure);
		info('Attempting to configure', target);
	} else {
		info('Configuring all devices');
	}
	log();

	let hasConfigured = false;
	let pending = 0;
	const browser = new Browser({
		cacheTime: 20
	});
	browser.on('available', reg => {
		if(target) {
			// There is a target so apply filter to make sure we match
			if(reg.id !== target && reg.address !== target) return;
		}

		if(typeof args.token === 'string') {
			reg.token = args.token;
		}
		else if(! reg.token) {
			warn(reg.id, 'at', reg.address, 'does not support auto-tokens, skipping configuration');
			log();
			return;
		}

		pending++;
		const device = new Device(reg);
		device.init()
			.then(() => {
				return device.management.info();
			})
			.then(info => {
				if(info.ap && info.ap.ssid === String(ssid)) {
					warn(reg.id, 'at', reg.address, 'is already configured to use this network');
					hasConfigured = true;
					return;
				}

				return device.management.updateWireless({
					ssid: String(ssid),
					passwd: String(passwd)
				}).then(r => {
					hasConfigured = true;
					info(reg.id, 'at', reg.address, 'now uses', ssid, 'as its network');
					log('  Token:', reg.token);
					log();
					return tokens.update(reg.id, reg.token);
				})
			})
			.catch(err => {
				error(reg.id, 'at', reg.address, 'encountered an error while configuring:', err.message);
				log();
			})
			.then(() => {
				pending--;
			})
	});

	setTimeout(() => {
		if(pending == 0) {
			if(! hasConfigured) {
				warn('No devices were configured');
			} else {
				info('Done');
			}
			process.exit(0);
		}
	}, 5000);

	setTimeout(() => {
		if(! hasConfigured) {
			warn('No devices were configured');
		} else {
			info('Done');
		}
		process.exit(0);
	}, 60000);
} else if(args.update) {
	let target = null;
	if(typeof args.update !== 'boolean') {
		// We want a specific address or id
		target = String(args.update);
		info('Attempting to update', target);
	} else {
		error('Need to specify id or address to device');
		process.exit(1);
	}

	if(! args.token) {
		error('Token is required when updating a device');
		process.exit(1);
	}

	let hasConfigured = false;
	let pending = 0;
	const browser = new Browser({
		cacheTime: 20,
		useTokenStorage: false
	});
	browser.on('available', reg => {
		if(target) {
			// There is a target so apply filter to make sure we match
			if(reg.id !== target && reg.address !== target) return;
		}

		pending++;
		reg.token = args.token;
		const device = new Device(reg);
		device.init()
			.then(() => device.management.info())
			.then(() => {
				return tokens.update(reg.id, args.token)
					.then(() => {
						info('Device updated');
					})
					.catch(err => {
						error('Could not update device:', err.message);
					});
			})
			.catch(err => {
				error('Could not update device, token might not be correct. Error was:', err.message);
			})
			.then(() => {
				pending--;
				hasConfigured = true;
				process.exit(0);
			});
	});

	setTimeout(() => {
		if(pending == 0) {
			if(! hasConfigured) {
				warn('Could not find device');
			} else {
				info('Done');
			}
			process.exit(0);
		}
	}, 5000);
} else if(args.inspect) {
	let target = null;
	if(typeof args.inspect !== 'boolean') {
		// We want a specific address or id
		target = String(args.inspect);
		info('Attempting to inspect', target);
	} else {
		error('Need to specify id or address to device');
		process.exit(1);
	}

	let foundDevice = false;
	let pending = 0;
	const browser = new Browser({
		cacheTime: 20
	});
	browser.on('available', reg => {
		if(target) {
			// There is a target so apply filter to make sure we match
			if(reg.id !== target && reg.address !== target) return;
		}

		pending++;
		if(! reg.token) {
			error('Can\'t connect to device, token could not be found');
			process.exit(1);
		}

		const device = new Device(reg);
		device.init()
			.then(() => device.management.info())
			.then(info => {
				const model = models[info.model];
				const supported = !! model;
				log();
				log(chalk.bold('Device ID:'), reg.id);
				log(chalk.bold('Model info:'), info.model, model ? chalk.dim('(' + model.TYPE + ')') : '');
				log(chalk.bold('Address:'), reg.address, (reg.hostname ? chalk.dim('(' + reg.hostname + ')') : ''));
				log(chalk.bold('Token:'), reg.token, reg.autoToken ? chalk.green('via auto-token') : chalk.yellow('via stored token'));
				log(chalk.bold('Support:'), (supported ? chalk.green('At least basic') : chalk.yellow('Generic')));
				log();

				log(chalk.bold('Firmware version:'), info.fw_ver);
				log(chalk.bold('Hardware version:'), info.hw_ver);
				if(info.mcu_fw_ver) {
					log(chalk.bold('MCU firmware version:'), info.mcu_fw_ver);
				}
				log();

				if(info.ap) {
					log(chalk.bold('WiFi:'), info.ap.ssid, chalk.dim('(' + info.ap.bssid + ')'), chalk.bold('RSSI:'), info.ap.rssi);
				} else {
					log(chalk.bold('WiFi:'), 'Not Connected');
				}
				log(chalk.bold('WiFi firmware version:'), info.wifi_fw_ver);
				log();

				if(info.ot) {
					let type;
					switch(info.ot) {
						case 'otu':
							type = 'UDP';
							break;
						case 'ott':
							type = 'TCP';
							break;
						default:
							type = 'Unknown (' + info.ot + ')';
					}
					console.log(chalk.bold('Remote access (Mi Home App):'), type);
				} else {
					console.log(chalk.bold('Remote access (Mi Home App):'), 'None');
				}
			})
			.catch(err => {
				error('Could not update device, token might not be correct. Error was:', err.message);
			})
			.then(() => {
				pending--;
				hasConfigured = true;
				process.exit(0);
			});
	});

	setTimeout(() => {
		if(pending == 0) {
			if(! foundDevice) {
				warn('Could not find device');
			}
			process.exit(0);
		}
	}, 5000);
} else if(args.packet) {
	if(! args.token) {
		error('Token is required to extract packet contents');
		process.exit(1);
	}

	const packet = new Packet();
	packet.token = Buffer.from(args.token, 'hex');

	if(typeof args.packet !== 'string') {
		error('--packet needs the packet data to do anything useful');
		process.exit(1);
	}
	const raw = Buffer.from(args.packet, 'hex');
	packet.raw = raw;

	const data = packet.data;
	if(! data) {
		error('Could not extract data from packet, check your token and packet data');
	} else {
		log('Hex: ', data.toString('hex'));
		log('String: ', data.toString());
	}
} else if(args['json-dump']) {
	if(! args.token) {
		error('Token is required to extract packets from JSON dump');
		process.exit(1);
	}

	const data = fs.readFileSync(args['json-dump']);
	const packets = JSON.parse(data.toString());

	const packet = new Packet();
	packet.token = Buffer.from(args.token, 'hex');

	packets.forEach(p => {
		const source = p._source;
		if(! source) return;

		const layers = source.layers;

		const udp = layers.udp;
		if(! udp) return;

		let out;
		if(udp['udp.dstport'] == '54321') {
			// Packet that is being sent to the device
			out = true;
		} else if(udp['udp.srcport'] == '54321') {
			// Packet coming from the device
			out = false;
		} else {
			// Unknown, skip it
			return;
		}


		const rawString = layers.data['data.data'];
		const raw = Buffer.from(rawString.replace(/:/g, ''), 'hex');
		packet.raw = raw;

		log(out ? chalk.bgBlue.white.bold(' -> ') : chalk.bgMagenta.white.bold(' <- '), chalk.yellow(layers.ip['ip.src']), chalk.dim('data='), packet.data ? packet.data.toString() : chalk.dim('N/A'));
	});
} else {
	error('Unsupported mode');
	process.exit(1);
}
