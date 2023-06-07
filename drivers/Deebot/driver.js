'use strict';

const { Driver }	= require('homey');
const ecovacsDeebot	= require('ecovacs-deebot');
const EcoVacsAPI	= ecovacsDeebot.EcoVacsAPI;
const http			= require('http');

let continent;

const VacuumDevice = require('./device');
class VacuumDriver extends Driver {

	async onInit() {
		this.log('Driver Vacuum has been initialized');
		this.log('appdebug: ' + appdebug)
	}

	onMapDeviceClass(device) {
		return VacuumDevice;
	}

	async onPair(session) {
		let username = "";
		let password = "";

		session.setHandler("login", async (data) => {
			username				= data.username;
			password				= data.password;
			let credentialsAreValid	= false;

			await httpGetJson('http://ipinfo.io/json').then(async (json) => {
				let device_id = EcoVacsAPI.md5(between(10000000, 99999999));
				let password_hash = EcoVacsAPI.md5(password);
				let country = json.country.toLowerCase();
				continent = ecovacsDeebot.countries[country.toUpperCase()].continent.toLowerCase();
				global.DeviceAPI = new EcoVacsAPI(device_id, country, continent);

				await global.DeviceAPI.connect(username, password_hash).then(() => {
					this.log("Connected!");
					credentialsAreValid = true;
				}).catch((e) => {
					this.error("Failure in connecting!");
				});

			});
			return credentialsAreValid;
		});

		session.setHandler("list_devices", async () => {
			let devices;
			await global.DeviceAPI.devices().then((devicesList) => {
				devices = devicesList.map((myDevice) => {
					return {
						name: myDevice.nick,
						data: {
							id: myDevice.did,
							api: global.DeviceAPI,
							username: username,
							password: password,
							geo: continent,
							vacuum: myDevice
						},

					};
				});
			});
			return devices;
		});
	}

	async onRepair(session, device) {
		this.log('Repairing'); 
		let data		= device.getData();
		let username	= data.username;
		let password	= data.password;

		await httpGetJson('http://ipinfo.io/json').then(async (json) => {
			let device_id		= EcoVacsAPI.md5(between(10000000, 99999999));
			let password_hash	= EcoVacsAPI.md5(password);
			let country			= json.country.toLowerCase();
			continent			= ecovacsDeebot.countries[country.toUpperCase()].continent.toLowerCase();
			global.DeviceAPI	= new EcoVacsAPI(device_id, country, continent);

			await global.DeviceAPI.connect(username, password_hash).then(() => {
				this.log("Connected!");
			}).catch((e) => {
				this.error("Failure in connecting!: ", e);
			});
		});
		data.api = global.DeviceAPI;
		device.onAdded();
	}

	log() {
		console.log.bind(this, new Date(new Date().getTime() + (new Date().getTimezoneOffset() * 60 * 1000)).toLocaleString('en-US', { day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: this.homey.clock.getTimezone(), hour12: false }).replace(',', '') + " [log] [Driver]").apply(this, arguments);
	}

	error() {
		console.error.bind(this, new Date(new Date().getTime() + (new Date().getTimezoneOffset() * 60 * 1000)).toLocaleString('en-US', { day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: this.homey.clock.getTimezone(), hour12: false }).replace(',', '') + " [err] [Driver]").apply(this, arguments);
	}

}

function httpGetJson(url) {
	return new Promise((resolve, reject) => {
		http.get(url, (res) => {
			res.setEncoding('utf8');
			let rawData = '';
			res.on('data', (chunk) => { rawData += chunk; });
			res.on('end', function () {
				try {
					const json = JSON.parse(rawData);
					resolve(json);
				} catch (e) {
					reject(e);
				}
			});
		}).on('error', (e) => {
			reject(e);
		});
	});
}

function between(min, max) {
	let num = Math.floor(
		Math.random() * (max - min) + min
	);
	return num.toString();
}

module.exports = VacuumDriver;

