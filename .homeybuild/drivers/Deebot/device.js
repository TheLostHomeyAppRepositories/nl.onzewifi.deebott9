'use strict';

const { Device } = require('homey');
const tools = require('../../lib/tools');
const ecovacsDeebot = require('ecovacs-deebot');
const stream = require('stream')
const luxon = require('luxon');
const EcoVacsAPI = ecovacsDeebot.EcoVacsAPI;
const SYNC_INTERVAL = 1000 * 30;  // 5 seconds

class VacuumDevice extends Device {

	async onInit() {

		this.log('Device ' + this.getName() + ' has been initialized');

		if (!this.hasCapability('SetParkPosition')) {
			this.log('Add SetParkPosition capability');
			this.addCapability('SetParkPosition');
		}

		if (!this.hasCapability('GotoParkPosition')) {
			this.log('Add GotoParkPosition capability');
			this.addCapability('GotoParkPosition');
		}

		this.homey.settings.on('set', (function (dynamicVariableName) {
			eval(dynamicVariableName + ' = this.homey.settings.get(dynamicVariableName)');
		}).bind(this));

		let api = global.DeviceAPI;
		if (api == null) {
			this.log('System reboot, reconnecting');
			this.driver.onRepair(null, this);
		} else {
			this.log('New device, congratulations!');
		}

		//this.registerCapabilityListener('onoff', this.onCapabilityOnoff.bind(this));
		this.registerCapabilityListener('alarm_tamper', this.onCapabilityAlert.bind(this));
		this.registerCapabilityListener('AutoClean', this.onCapabilityAutoClean.bind(this));
		this.registerCapabilityListener('PauseCleaning', this.onCapabilityPauseCleaning.bind(this));
		this.registerCapabilityListener('ReturnDock', this.onCapabilityReturnDock.bind(this));
		this.registerCapabilityListener('AutoEmpty', this.onCapabilityAutoEmpty.bind(this));
		this.registerCapabilityListener('VacuumPower', this.onCapabilityVacuumPower.bind(this));
		this.registerCapabilityListener('CleanCount', this.onCapabilityCleanCount.bind(this));
		this.registerCapabilityListener('WaterFlowLevel', this.onCapabilityWaterFlowLevel.bind(this));
		this.registerCapabilityListener('ScrubbingType', this.onCapabilityScrubbingType.bind(this));
		this.registerCapabilityListener('AromaMode', this.onCapabilityAromaMode.bind(this));
		this.registerCapabilityListener('GotoParkPosition', this.onCapabilityGotoParkPosition.bind(this));
		this.registerCapabilityListener('SetParkPosition', this.onCapabilitySetParkPosition.bind(this));

		//this.setStoreValue('flowTokens', []).catch((error) => { this.error('Error: ' + error); });

		const actionAutoClean = this.homey.flow.getActionCard('AutoClean');
		actionAutoClean.registerRunListener(async (args, state) => {
			if (appdebug) { this.log('Cmd: vacbot.clean()'); }
			this.vacbot.clean();
		});

		const actionGotoParkPosition = this.homey.flow.getActionCard('GotoParkPosition');
		actionGotoParkPosition.registerRunListener(async (args, state) => {
			if (appdebug) { this.log('vacbot.run(GoToPosition, area)'); }
			const area = this.getStoreValue('parkPosition');
			this.vacbot.run('GoToPosition', area);
			this.setCapabilityValue('GotoParkPosition', true).catch((error) => { this.error('Error: ' + error); });
		});

		const actionRetunrDock = this.homey.flow.getActionCard('ReturnDock');
		actionRetunrDock.registerRunListener(async (args, state) => {
			this.setCapabilityValue('ReturnDock', true).catch((error) => { this.error('Error: ' + error); });
			if (appdebug) { this.log('Cmd: vacbot.charge()'); }
			this.vacbot.charge();
		});

		const actionEmptyDustBin = this.homey.flow.getActionCard('EmptyDustBin');
		actionEmptyDustBin.registerRunListener(async (args, state) => {
			if (appdebug) { this.log('Cmd: vacbot.run(EmptyDustBin)'); }
			this.vacbot.run('EmptyDustBin');
		});

		const actionPauseCleaning = this.homey.flow.getActionCard('PauseCleaning');
		actionPauseCleaning.registerRunListener(async (args, state) => {
			this.setCapabilityValue('PauseCleaning', true).catch((error) => { this.error('Error: ' + error); });
			if (appdebug) { this.log('Cmd: vacbot.pause()'); }
			this.vacbot.pause();
		});

		const actionResumeCleaning = this.homey.flow.getActionCard('ResumeCleaning');
		actionResumeCleaning.registerRunListener(async (args, state) => {
			this.setCapabilityValue('PauseCleaning', false).catch((error) => { this.error('Error: ' + error); });
			if (appdebug) { this.log('Cmd: vacbot.resume()'); }
			this.vacbot.resume();
		});

		const actionSpotArea = this.homey.flow.getActionCard('SpotArea');
		actionSpotArea.registerArgumentAutocompleteListener('zone', this.flowAutocompleteactionSpotArea.bind(this));
		actionSpotArea.registerRunListener(async (args, state) => {
			if (appdebug) { this.log('Cmd: vacbot.spotArea(' + args.zone.zoneid + ')'); }
			if (args.zone) {
				this.vacbot.spotArea(args.zone.zoneid);
			}
		});

		const actionSpotAreas = this.homey.flow.getActionCard('SpotAreas');
		actionSpotAreas.registerRunListener(async (args, state) => {
			if (args.zones) {
				var currentMap = this.getStoreValue('currentMap');
				let Zones = [];
				if (args.zones.includes('[')) {
					// Asume flowtokens are being used, but remove anything that is not in the [x:y] format
					let ZoneTokens = args.zones.match(/\[(.*?)\]/g);
					if (ZoneTokens) {
						ZoneTokens.forEach(ZoneToken => {
							let floorRoom = ZoneToken.split(':');
							let Floor = parseInt(floorRoom[0].replace(/[\[\]]/g, ''));
							let Zone = parseInt(floorRoom[1].replace(/[\[\]]/g, ''));
							if (!isNaN(Floor) && !isNaN(Zone)) { Zones.push({ Floor: Floor, Zone: Zone }); }
						});
					}
				} else {
					// Asume roomnumbers (seperated by a comma) are being used, but remove anything other then numbers and commas
					let Rooms = args.zones.replace(/\[.*?\]/g, '').replace(/\s/g, '').split(',');
					Rooms.forEach(Room => {
						if (/^\d+$/.test(Room)) {
							let Zone = parseInt(Room);
							if (!isNaN(Zone)) { Zones.push({ Floor: currentMap.mapIndex, Zone: Zone }); }
						}
					});
				}
				// If you want to filter rooms on the current floor, uncomment the line below
				// Zones = Zones.filter(Zone => Zone.Floor === currentMap.mapIndex);
				let CleaningZones = Zones.map(Zone => Zone.Zone).join(',');
				this.log('Clean zones: ' + CleaningZones);
				this.vacbot.spotArea(CleaningZones);
				if (appdebug) { this.log('Cmd: vacbot.spotArea(' + CleaningZones + ')'); }
			}
		});

		const actionRawCommand = this.homey.flow.getActionCard('RawCommand');
		actionRawCommand.registerRunListener(async (args, state) => {
			if (appdebug) { this.log('Cmd: vacbot.run(' + args.command + ')'); }
			this.vacbot.run(args.command);
		});

		const conditionMoppingModule = this.homey.flow.getConditionCard('MoppingModule');
		conditionMoppingModule.registerRunListener(async (args, state) => {
			const MoppingModule = await this.getCapabilityValue('MopStatus');
			return MoppingModule;
		});

		const conditionAutoEmptyState = this.homey.flow.getConditionCard('AutoEmptyState');
		conditionAutoEmptyState.registerRunListener(async (args, state) => {
			const AutoEmptyState = await this.getCapabilityValue('AutoEmpty');
			return AutoEmptyState;
		});

		const conditionCurrentMap = this.homey.flow.getConditionCard('CurrentMap');
		conditionCurrentMap.registerRunListener(async (args, state) => {
			return this.getStoreValue('currentMap').mapID == args.mapname.mapid;
		});

		conditionCurrentMap.registerArgumentAutocompleteListener('mapname', async (query, args) => {
			var filtered = this.getStoreValue('mapnames').filter((element) => {
				return element.name.toLowerCase().includes(query.toLowerCase());
			});
			return filtered;
		});

	}

	async onAdded() {
		this.log('Vacuum has been added');

		let data = this.getData();
		let api = global.DeviceAPI;
		let init = true;

		this.setStoreValue('areas', []).catch((error) => { this.error('Error: ' + error); });
		this.setStoreValue('mapnames', []).catch((error) => { this.error('Error: ' + error); });
		//this.setStoreValue('flowTokens', []).catch((error) => { this.error('Error: ' + error); });

		this.log('Deebot ApiVersion : ', api.getVersion());
		this.vacbot = api.getVacBot(api.uid, EcoVacsAPI.REALM, api.resource, api.user_access_token, data.vacuum, data.geo);

		this.vacbot.on('ready', async (event) => {

			this.log('Model information');
			this.log('- Name: ' + this.vacbot.getName());
			this.log('- Model: ' + this.vacbot.deviceModel);
			this.log('- Image url: ' + this.vacbot.deviceImageURL);
			this.log('- Is fully supported model: ' + this.vacbot.isSupportedDevice());
			this.log('- Is a at least partly supported model: ' + this.vacbot.isKnownDevice());
			this.log('- Is legacy model: ' + this.vacbot.isLegacyModel());
			this.log('- Is 950 type model: ' + this.vacbot.is950type());
			this.log('- V2 commands are implemented: ' + this.vacbot.is950type_V2());
			this.log('- Communication protocol: ' + this.vacbot.getProtocol());
			this.log('- Main brush: ' + this.vacbot.hasMainBrush());
			this.log('- Mapping capabilities: ' + this.vacbot.hasMappingCapabilities());
			this.log('- Edge cleaning mode: ' + this.vacbot.hasEdgeCleaningMode());
			this.log('- Spot cleaning mode: ' + this.vacbot.hasSpotCleaningMode());
			this.log('- Spot area cleaning mode: ' + this.vacbot.hasSpotAreaCleaningMode());
			this.log('- Custom area cleaning mode: ' + this.vacbot.hasCustomAreaCleaningMode());
			this.log('- Mopping system: ' + this.vacbot.hasMoppingSystem());
			this.log('- Voice reports: ' + this.vacbot.hasVoiceReports());
			this.log('- Auto empty station: ' + this.vacbot.hasAutoEmptyStation());
			this.log('- Canvas module available: ' + api.getCanvasModuleIsAvailable());
			this.log('- Using country: ' + api.getCountryName());
			this.log('- Using continent code: ' + api.getContinent());
			this.log('ApiVersion : ' + api.getVersion());
			this.setAvailable();
			this.log('Device is ready');

			this.setSettings({
				username: data.username,
				password: data.password,
			});

			const latestCleanLogImage = await this.homey.images.createImage();
			const previousCleanLogImage = await this.homey.images.createImage();
			const triggerCleanLogImage = await this.homey.images.createImage();

			if (appdebug) { this.log('vacbot.run(GetMaps)'); } this.vacbot.run('GetMaps');
			if (appdebug) { this.log('vacbot.run(GetWaterBoxInfo)'); } this.vacbot.run('GetWaterBoxInfo');
			if (appdebug) { this.log('vacbot.run(GetCleanCount)'); } this.vacbot.run('GetCleanCount');
			if (appdebug) { this.log('vacbot.run(GetCleanSpeed)'); } this.vacbot.run('GetCleanSpeed');
			if (appdebug) { this.log('vacbot.run(GetWaterLevel)'); } this.vacbot.run('GetWaterLevel');
			if (appdebug) { this.log('vacbot.run(GetAutoEmpty)'); } this.vacbot.run('GetAutoEmpty');
			if (appdebug) { this.log('vacbot.run(GetBatteryState)'); } this.vacbot.run('GetBatteryState');
			if (appdebug) { this.log('vacbot.run(GetCleanState)'); } this.vacbot.run('GetCleanState');
			if (appdebug) { this.log('vacbot.run(GetCleanLogs)'); } this.vacbot.run('GetCleanLogs');
			if (appdebug) { this.log('vacbot.run(GetPosition)'); } this.vacbot.run('GetPosition');

			const changeChargeStateTrigger = this.homey.flow.getDeviceTriggerCard('ChargeState');
			const changeOperationTrigger = this.homey.flow.getDeviceTriggerCard('Operation');
			const changeZoneTrigger = this.homey.flow.getDeviceTriggerCard('LocationReport');
			const errorReportTrigger = this.homey.flow.getDeviceTriggerCard('ErrorReport');
			const cleanReportTrigger = this.homey.flow.getDeviceTriggerCard('CleanReport');

			// this.vacbot.run('GetAromaMode'); Not working (yet?)

			this.vacbot.on('WaterBoxInfo', (level) => {
				this.setCapabilityValue('MopStatus', Boolean(level)).catch((error) => { this.error('Error: ' + error); });
				if (appdebug) { this.log('setCapabilityValue(MopStatus, ' + Boolean(level) + ')'); }
			});

			this.vacbot.on('CleanCount', (mode) => {
				this.setCapabilityValue('CleanCount', Boolean((mode - 1))).catch((error) => { this.error('Error: ' + error); });
				if (appdebug) { this.log('setCapabilityValue(CleanCount, ' + Boolean((mode - 1)) + ')'); }
			});

			this.vacbot.on('CleanSpeed', (level) => {
				this.setCapabilityValue('VacuumPower', level.toString()).catch((error) => { this.error('Error: ' + error); });
				if (appdebug) { this.log('setCapabilityValue(VacuumPower, ' + level.toString() + ')'); }
			});

			this.vacbot.on('WaterLevel', (level) => {
				this.setCapabilityValue('WaterFlowLevel', level.toString()).catch((error) => { this.error('Error: ' + error); });
				if (appdebug) { this.log('setCapabilityValue(WaterFlowLevel, ' + level.toString() + ')'); }
			});

			this.vacbot.on('AutoEmpty', (mode) => {
				this.setCapabilityValue('AutoEmpty', Boolean(mode)).catch((error) => { this.error('Error: ' + error); });
				if (appdebug) { this.log('setCapabilityValue(AutoEmpty, ' + Boolean(mode) + ')'); }
			});

			this.vacbot.on('AromaMode', (mode) => {
				this.setCapabilityValue('AromaMode', Boolean(mode)).catch((error) => { this.error('Error: ' + error); });
				if (appdebug) { this.log('setCapabilityValue(AromaMode, ' + Boolean(mode) + ')'); }
			});

			this.vacbot.on('BatteryInfo', (battery) => {
				this.setCapabilityValue('measure_battery', Math.round(battery)).catch((error) => { this.error('Error: ' + error); });
				if (appdebug) { this.log('setCapabilityValue(measure_battery, ' + Math.round(battery) + ')'); }
			});

			this.vacbot.on('WaterBoxScrubbingType', (mode) => {
				this.setCapabilityValue('ScrubbingType', Boolean(mode - 1)).catch((error) => { this.error('Error: ' + error); });
				if (appdebug) { this.log('setCapabilityValue(ScrubbingType, ' + Boolean(mode - 1) + ')'); }
			});

			this.vacbot.on('CleanLog', async (object) => {
				if (appdebug) { this.log('vacbot.on(CleanLog, ' + object + ')'); }
				try {
					if (init) {
						this.log('Updating latest CleanLog image')
						latestCleanLogImage.setStream(async (stream) => {
							const latestCleanLogImageData = await this.vacbot.downloadSecuredContent(object[0].imageUrl).catch((error) => { this.error('Error: ' + error); });
							return latestCleanLogImageData.body.pipe(stream);
						});
						this.setCameraImage('Latest Cleanlog', 'Latest Cleanlog', latestCleanLogImage).catch((error) => { this.error('Error: ' + error); });
					}
				} catch (error) { this.error('error: ' + error); this.error('object: ' + JSON.stringify(object)); }

				try {
					if (init) {
						this.log('Updating previous CleanLog image')
						previousCleanLogImage.setStream(async (stream) => {
							const previousCleanLogImageData = await this.vacbot.downloadSecuredContent(object[1].imageUrl).catch((error) => { this.error('Error: ' + error); });
							return previousCleanLogImageData.body.pipe(stream);
						  });
						  this.setCameraImage('Previous Cleanlog', 'Previous Cleanlog', previousCleanLogImage).catch((error) => { this.error('Error: ' + error); });
					}
				} catch (error) { this.error('error: ' + error); this.error('object: ' + JSON.stringify(object)); }

				try {
					if (init) {
						this.log('Updating CleanLog trigger image')
						triggerCleanLogImage.setStream(async (stream) => {
							const triggerCleanLogImageData = await this.vacbot.downloadSecuredContent(object[0].imageUrl).catch((error) => { this.error('Error: ' + error); });
							return triggerCleanLogImageData.body.pipe(stream);
						});
					}
				} catch (error) { this.error('error: ' + error); this.error('object: ' + JSON.stringify(object)); }

				var stopReason = -1;
				try {
					switch ((object[0].stopReason - 1).toString()) {
						case '0': stopReason = 'CLEAN_SUCCESSFUL'; break;
						case '1': stopReason = 'BATTERY_LOW'; break;
						case '2': stopReason = 'STOPPED_BY_APP'; break;
						case '3': stopReason = 'STOPPED_BY_IR'; break;
						case '4': stopReason = 'STOPPED_BY_BUTTON'; break;
						case '5': stopReason = 'STOPPED_BY_WARNING'; break;
						case '6': stopReason = 'STOPPED_BY_NO_DISTURB'; break;
						case '7': stopReason = 'STOPPED_BY_CLEARMAP'; break;
						case '8': stopReason = 'STOPPED_BY_NO_PATH'; break;
						case '9': stopReason = 'STOPPED_BY_NOT_IN_MAP'; break;
						case '10': stopReason = 'STOPPED_BY_VIRTUAL_WALL'; break;
						case '11': stopReason = 'WIRE_CHARGING'; break;
						case '12': stopReason = 'STOPPED_BY_AIR_SPOT'; break;
						case '13': stopReason = 'STOPPED_BY_AIR_AUTO'; break;
						default: stopReason = 'UNKNOWN (' + object[0].stopReason + ')';
					}
				}
				catch {
					this.error('no stopReason error: ' + error);
					this.error('object: ' + JSON.stringify(object));
				}

				var tokens = {
					image: triggerCleanLogImage,
					date: luxon.DateTime.fromJSDate(new Date(object[0].date.toString())).setZone(await this.homey.clock.getTimezone()).toFormat("dd-MM-yyyy HH:mm:ss"),
					stopReason: stopReason,
					type: object[0].type.toString(),
					mopped: this.getCapabilityValue('MopStatus')
				};

				if (appdebug) { this.log('Init: ' + init); }
				if (!init) {
					this.log('New CleanLog was received, triggering cleanReportTrigger');
					cleanReportTrigger.trigger(this, tokens);
				} else {
					init = false;
				}
			});

			this.vacbot.on('CleanReport', (status) => {
				if (appdebug) { this.log('vacbot.on(CleanReport, ' + status + ')'); }
				if (status !== this.getCapabilityValue('Operation')) {
					this.log('Current Operation: ' + status);
					this.setCapabilityValue('alarm_tamper', false).catch((error) => { this.error('Error: ' + error); });
					switch (status) {
						case 'parking':
							this.setCapabilityValue('AutoClean', false).catch((error) => { this.error('Error: ' + error); });
							this.setCapabilityValue('ReturnDock', false).catch((error) => { this.error('Error: ' + error); });
							this.setCapabilityValue('PauseCleaning', false).catch((error) => { this.error('Error: ' + error); });
							this.setCapabilityValue('GotoParkPosition', true).catch((error) => { this.error('Error: ' + error); });
							break;
						case 'pause':
							this.setCapabilityValue('PauseCleaning', true).catch((error) => { this.error('Error: ' + error); });
							break;
						case 'idle':
							const PauseCleaning = this.getCapabilityValue('PauseCleaning');
							this.setCapabilityValue('AutoClean', false).catch((error) => { this.error('Error: ' + error); });
							this.setCapabilityValue('ReturnDock', false).catch((error) => { this.error('Error: ' + error); });
							this.setCapabilityValue('PauseCleaning', false).catch((error) => { this.error('Error: ' + error); });
							if (!PauseCleaning) { this.vacbot.run('GetCleanLogs'); }
							break;
						case 'auto':
							this.setCapabilityValue('AutoClean', true).catch((error) => { this.error('Error: ' + error); });
							this.setCapabilityValue('ReturnDock', false).catch((error) => { this.error('Error: ' + error); });
							this.setCapabilityValue('PauseCleaning', false).catch((error) => { this.error('Error: ' + error); });
							this.setCapabilityValue('GotoParkPosition', false).catch((error) => { this.error('Error: ' + error); });
							break;
						case 'returning':
							this.setCapabilityValue('AutoClean', false).catch((error) => { this.error('Error: ' + error); });
							this.setCapabilityValue('ReturnDock', true).catch((error) => { this.error('Error: ' + error); });
							this.setCapabilityValue('PauseCleaning', false).catch((error) => { this.error('Error: ' + error); });
							this.setCapabilityValue('GotoParkPosition', false).catch((error) => { this.error('Error: ' + error); });
							break;
						case 'alert':
							this.setCapabilityValue('alarm_tamper', true).catch((error) => { this.error('Error: ' + error); });
							break;
						default:
							this.setCapabilityValue('ReturnDock', false).catch((error) => { this.error('Error: ' + error); });
							this.setCapabilityValue('AutoClean', false).catch((error) => { this.error('Error: ' + error); });
							this.setCapabilityValue('PauseCleaning', false).catch((error) => { this.error('Error: ' + error); });
							this.setCapabilityValue('GotoParkPosition', false).catch((error) => { this.error('Error: ' + error); });
					}
				}
				if (typeof status !== "undefined") {
					this.setCapabilityValue('Operation', status).catch((error) => { this.error('Error: ' + error); });
					changeOperationTrigger.trigger(this, { operation: status });
				} else {
					this.setCapabilityValue('Operation', 'Going loco! (' + state + ')').catch((error) => { this.error('Error: ' + error); });
				}
			});

			this.vacbot.on('ChargeState', (status) => {
				if (appdebug) { this.log('vacbot.on(ChargeState, ' + status + ')'); }
				let oldStatus = this.getCapabilityValue('Charge');

				switch (status) {
					case 'idle':
						this.setCapabilityValue('Charge', 'Discharging').catch((error) => { this.error('Error: ' + error); });
						break;
					case 'charging':
						if (this.getCapabilityValue('measure_battery') !== 100) {
							this.setCapabilityValue('Charge', 'Charging').catch((error) => { this.error('Error: ' + error); });
						} else {
							this.setCapabilityValue('Charge', 'Fully charged').catch((error) => { this.error('Error: ' + error); });
						}
						break;
					default:
						this.setCapabilityValue('Charge', 'Unknown').catch((error) => { this.error('Error: ' + error); });
				}

				if (oldStatus && (oldStatus != status)) {
					try {
						changeChargeStateTrigger.trigger(this, { state: this.getCapabilityValue('Charge') });
					}
					catch (error) {
						this.error('ChargeState trigger error: ', error);
					}
				}
			});

			this.vacbot.on('Maps', async (maps) => {
				if (appdebug) { this.log('vacbot.on(Maps, ' + maps + ')'); }
				this.log('Updating Maps');
				var mapnames = [];
				for (const map of maps['maps']) {
					mapnames.push(
						{
							'mapid': map['mapID'],
							'mapIndex': map['mapIndex'],
							'name': map['mapName'],
							'mapStatus': map['mapStatus'],
							'mapIsCurrentMap': map['mapIsCurrentMap']
						}
					);
					this.setStoreValue('mapnames', mapnames).catch((error) => { this.error('Error: ' + error); });
					const mapID = map['mapID'];
					const mapIndex = map['mapIndex'];
					if (map['mapIsCurrentMap']) {
						this.setStoreValue('currentMap', { 'mapID': mapID, 'MapIndex': mapIndex }).catch((error) => { this.error('Error: ' + error); });
					}
					this.log('-Updating Floor ' + map['mapName']);
					await this.vacbot.run('GetSpotAreas', mapID);
					// await new Promise(resolve => setTimeout(resolve, 2000));
				}
			});

			this.vacbot.on('MapSpotAreas', async (spotAreas) => {
				if (appdebug) { this.log('vacbot.on(MapSpotAreas, ' + spotAreas + ')'); }
				for (const spotArea of spotAreas['mapSpotAreas']) {
					const spotAreaID = spotArea['mapSpotAreaID'];
					await this.vacbot.run('GetSpotAreaInfo', spotAreas['mapID'], spotAreaID);
				}
			});

			this.vacbot.on('MapSpotAreaInfo', async (area) => {
				if (appdebug) { this.log('vacbot.on(MapSpotAreaInfo, ' + area + ')'); }
				var tableAreas = this.getStoreValue('areas');
				const index = tableAreas.findIndex(element => element.id === area.mapSpotAreaID);
				if (index !== -1) { tableAreas.splice(index, 1); }
				if (!tableAreas.find(o => o.id == area.mapSpotAreaID)) {
					tableAreas.push(
						{
							mapid: area.mapID,
							name: area.mapSpotAreaName,
							zoneid: area.mapSpotAreaID,
							id: area.mapID + area.mapSpotAreaID,
							toto: area.mapSpotAreaBoundaries,
							boundaries: this.convertBoundaries(area.mapSpotAreaBoundaries),
						}
					);
					this.setStoreValue('areas', tableAreas).catch((error) => { this.error('Error: ' + error); });
					//console.log(area.mapID, area.mapSpotAreaID)
					//console.log('!')
					await this.createToken(area.mapID, area.mapSpotAreaID, area.mapSpotAreaName).then(() => { this.log('--Updated Zone ' + area.mapSpotAreaName); });
					if (appdebug) { this.log(JSON.stringify(tableAreas)); }
				}
			});

			this.vacbot.on('DeebotPosition', async (values) => {

				const SetParkPosition = await this.getCapabilityValue('SetParkPosition');
				const PauseCleaning = await this.getCapabilityValue('PauseCleaning');

				if (SetParkPosition && PauseCleaning) {
					this.setStoreValue('parkPosition', values).catch((error) => { this.error('Error: ' + error); });
					if (appdebug) { this.log('Park position set to ', values); }
					setTimeout(() => {
						this.setCapabilityValue('SetParkPosition', false).catch((error) => { this.error('Error: ' + error); });
					}, 1000);
				}

				let CurrentZone = 'unknown';
				let OldZone = this.getCapabilityValue('CurrentZone');
				let currentMap = this.getStoreValue('currentMap');
				var tableAreas = this.getStoreValue('areas');
				tableAreas.forEach(function (area) {
					let coord = values.split(',');
					if (tools.pointInPolygon(area.boundaries, [Number(coord[0]), Number(coord[1])]) && area.mapid == currentMap.mapID) {
						CurrentZone = area.name;
					}
				});
				this.setCapabilityValue('CurrentZone', CurrentZone).catch((error) => { this.error('Error: ' + error); });
				if (OldZone && (OldZone != CurrentZone)) {
					try {
						this.setCapabilityValue('PauseCleaning', false).catch((error) => { this.error('Error: ' + error); });
						changeZoneTrigger.trigger(this, { zone: CurrentZone });
					}
					catch (error) {
						this.error('DeebotPosition trigger error: ', error);
					}
				}
			});

			this.vacbot.on('ErrorCode', (errorcode) => {
				if (parseInt(errorcode) !== 0 && parseInt(errorcode) !== 100) {
					var error = JSON.stringify(this.homey.__("Deebot.Error" + errorcode));
					this.error('DeebotPosition trigger error: ', error + " (errorcode " + errorcode + ")");
					errorReportTrigger.trigger(this, { error: error, errorcode: parseInt(errorcode) });
				}
			});
		});

		this.vacbot.connect();

		setInterval(async function () {
			// if (createTokens) {
			// 	this.log('Recreating flowTokens')
			// 	createTokens = await this.createTokens().catch((error) => { this.error('Error: ' + error); });
			// }
		}.bind(this), SYNC_INTERVAL);

	}

	async ready() {
		this.log('device:ready');
	}

	onDiscoveryResult(discoveryResult) {
		this.log('onDiscoveryResult');
		return discoveryResult.id === this.getData().id;
	}

	onDiscoveryAvailable(discoveryResult) {
		this.log('onDiscoveryAvailable', discoveryResult);
		//this.setStoreValue('address', discoveryResult.address);
	}

	onDiscoveryAddressChanged(discoveryResult) {
		this.log('onDiscoveryAddressChanged', discoveryResult);
		// todo set in store
	}

	onDiscoveryLastSeenChanged(discoveryResult) {
		this.log('onLastSeenChanged', discoveryResult);
	}

	async onSettings({ oldSettings, newSettings, changedKeys }) {
		this.log('MyDevice settings where changed', oldSettings, newSettings, changedKeys);
	}

	async onRenamed(name) {
		this.log('Device was renamed to' + this.getName());
	}

	async onDeleted() {
		this.log('Device ' + this.getName() + 'has been deleted');
		this.vacbot.disconnect();
	}

	async onCapabilityVacuumPower(value, opts) {
		this.vacbot.run('SetCleanSpeed', Number(value));
	}

	async onCapabilityCleanCount(boolean, opts) {
		this.log('onCapabilityCleanCount: ' + (Number(boolean) + 1));
		this.vacbot.run('SetCleanCount', (Number(boolean) + 1));
	}

	async onCapabilityWaterFlowLevel(value, opts) {
		this.vacbot.run('SetWaterLevel', Number(value), (Number(this.getCapabilityValue('ScrubbingType')) + 1));
	}

	async onCapabilityAutoEmpty(boolean, opts) {
		this.vacbot.run('SetAutoEmpty', Number(boolean));
	}

	async onCapabilityScrubbingType(boolean, opts) {
		this.vacbot.run('SetWaterLevel', this.getCapabilityValue('WaterFlowLevel'), (Number(boolean) + 1));
	}

	async onCapabilityAromaMode(value, opts) {
		//
	}

	async onCapabilityGotoParkPosition(value, opts) {
		if (appdebug) { this.log('Navigating to Park Position'); }
		this.setCapabilityValue('Operation', 'parking').catch((error) => { this.error('Error: ' + error); });
		const area = this.getStoreValue('parkPosition');
		this.vacbot.run('GoToPosition', area);
	}

	async onCapabilitySetParkPosition(value, opts) {
		const PauseCleaning = await this.getCapabilityValue('PauseCleaning');
		if (PauseCleaning) {
			this.vacbot.run('GetPosition');
		} else {
			if (appdebug) { this.log('Not setting Park Position; Deebot not pauzed!'); }
		}
	}

	async onCapabilityAlert(boolean, opts) {
		vacbot.run('GoToPosition', area);
	}

	async onCapabilityAutoClean(value, opts) {
		if (value) {
			this.vacbot.clean();
		} else {
			this.vacbot.stop();
		}
	}

	async onCapabilityPauseCleaning(value, opts) {
		if (value) {
			if (this.getCapabilityValue('Operation') !== 'idle') {
				this.vacbot.run('Pause');
			} else {
				this.log('Operation idle, can not pause that!');
				setTimeout(() => {
					this.setCapabilityValue('PauseCleaning', false).catch((error) => { this.error('Error: ' + error); });
				}, 1000);
			}
		} else {
			this.vacbot.run('Resume');
		}
	}

	async onCapabilityReturnDock(value, opts) {
		if (value) {
			if (this.getCapabilityValue('Charge') !== 'charging') {
				this.vacbot.run('Charge');
			} else {
				setTimeout(() => {
					this.log('Deebot already docked, no need to return');
					this.setCapabilityValue('ReturnDock', false).catch((error) => { this.error('Error: ' + error); });
				}, 1000);
			}
		}
	}

	async flowAutocompleteactionSpotArea(query, args) {
		var tableAreas = this.getStoreValue('areas');
		var filtered = tableAreas.filter((element) => {
			return element.name.toLowerCase().includes(query.toLowerCase());
		});
		return filtered;
	}

	//////////////////////////////////////////// Utilities ///////////////////////////////////////

	convertBoundaries(areaBoundaries) {
		let tableau = areaBoundaries.split(';');
		let resultat = [];

		tableau.forEach(function (element) {
			let point = element.split(',');
			resultat.push([Number(point[0]), Number(point[1])]);
		});

		return resultat;
	}

	async createToken(mapID, mapSpotAreaID, mapSpotAreaName) {
		var mapnames = this.getStoreValue('mapnames');
		var level = this.getStoreValue('mapnames').findIndex((x) => { return x.mapid === mapID; });
		var tokenName = mapnames.filter(obj => { return obj.mapid === mapID; })[0].name + ' - ' + mapSpotAreaName;
		var tokenID = level + ':' + mapSpotAreaID;

		if (appdebug) { this.log(`Updating flowToken ${tokenName} (tokenID ${tokenID}) with value [${level}:${mapSpotAreaID}]`); }

		// First try to see if the flowToken already exists, if so first unregister it
		try {
			const existingToken = this.homey.flow.getToken(tokenID);
			await this.homey.flow.unregisterToken(existingToken)
				.then(() => {
					;
					if (appdebug) { this.log(`Token (${existingToken.opts.title}) already existed, unresitered the token`); }
				})
				.catch((error) => {
					this.error(`TokenID (${tokenID}) already existed, but unregistering failed!`);
				});
		}
		catch {
			if (appdebug) { this.log(`TokenID ${tokenID} (${tokenName}) didn't exist, creating the token`); }
		}

		// (re-) Create the flowToken and set it's value
		await this.homey.flow.createToken(tokenID, { type: 'string', title: tokenName })
			.then((createToken) => {
				return createToken.setValue('[' + level + ':' + mapSpotAreaID + ']');
			})
			.then(() => {
				if (appdebug) { this.log(`Updated flowToken ${tokenName} (tokenID ${tokenID}) with value [${level}:${mapSpotAreaID}]`); }
			})
			.catch((error) => {
				this.error('Error creating or setting flow token: ' + error);
			});
	}
}

module.exports = VacuumDevice;
