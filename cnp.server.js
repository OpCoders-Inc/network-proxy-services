//Commodore Network Protocol (CNP) server
//Copyright (c) 2024 OpCoders Inc.

//System Control Service

//systemctl start c64os.cnpserver.service
//systemctl stop  c64os.cnpserver.service

const VERSION = "1.0";

console.log("Commodore Network Protocol (CNP) server v"+VERSION);
console.log("Copyright (c) 2024 OpCoders Inc.\n");

const networkModule = require('net');
const mysql 				= require('mysql');
const cryptoJS 			= require("crypto-js");
const { Buffer }    = require("node:buffer");
const config 				= require('config');

const pt_alive_alt = 0x2d; "+";
const pt_alive 	   = 0x2d; "-";

const pt_serv  = 0x53; "S";

const pt_open  = 0x4f; "O";
const pt_close = 0x43; "C";
const pt_time  = 0x54; "T";

const pt_ack   = 0x41 ;"A";
const pt_nak   = 0x4e ;"N";

const pt_data  = 0x44; "D";

var listenPort    = 6400;
var authTimeout   = 10; 		 //10 Seconds
var socketTimeout = 60 * 10; //10 Minutes
var quietMode     = 0;

var connectedClients = [];

var authServerCredentials = {
  host: 		config.get('cnp_server_mysql.host'),
  user: 		config.get('cnp_server_mysql.user'),
  password: config.get('cnp_server_mysql.password'),
  database: config.get('cnp_server_mysql.database')
};

//console.log(process.argv);

function displayHelp() {
	console.log("Available options:\n");
	console.log("[help|-help|?|-?] this help screen");
	console.log("[port|listenport {1025-65535}] change the listen port");
	console.log("[authtimeout {seconds}] change the client authentication timeout");
	console.log("[timeout {seconds}] change the client connection timeout");
	console.log("[quiet {0|1}] change whether client connection messages are shown.");
	console.log("");
}

var skipToArgVIndex = 2;

process.argv.forEach(function(value,index) {
	if(index < skipToArgVIndex)
		return;

	switch(value) {
		case "?":
		case "-?":
		case "help":
		case "-help":
			displayHelp();
			process.exit();
		break;

		case "port":
		case "listenport":
			listenPort = parseInt(process.argv[index+1]);
			if(isNaN(listenPort) || listenPort < 1024 || listenPort > 65535) {
				console.log("listen port must be a number between 1025 and 65535");
				process.exit();
			}
			
			skipToArgVIndex = index+2;
			return;
		break;

		case "authtimeout":
			authTimeout = parseInt(process.argv[index+1]);
			if(isNaN(authTimeout) || authTimeout < 1 || authTimeout > 60) {
				console.log("authentication timeout must be a number between 1 and 60");
				process.exit();
			}
			
			skipToArgVIndex = index+2;
			return;
		break;

		case "timeout":
			socketTimeout = parseInt(process.argv[index+1]);
			if(isNaN(socketTimeout) || socketTimeout < 5 || socketTimeout > 60 * 10) {
				console.log("socket timeout must be a number between 5 and 600");
				process.exit();
			}
			
			skipToArgVIndex = index+2;
			return;
		break;

		case "quiet":
			quietMode = parseInt(process.argv[index+1]);
			if(isNaN(quietMode) || quietMode < 0 || quietMode > 1) {
				console.log("quiet must be either 0 or 1");
				process.exit();
			}
			
			skipToArgVIndex = index+2;
			return;
		break;
		
		default:
			console.log("Unrecognized argument: "+value);
			displayHelp();
			process.exit();
		break;
	}
});

var authMySQLServer = null;

function connectToAuthServer(connectCallback) {
	authMySQLServer = mysql.createConnection(authServerCredentials);

	authMySQLServer.connect(function(err) {
		if(err) 
			throw err;
		
		quietableLog("connected to authentication server.");
		
		if(typeof connectCallback == "function")
			connectCallback();
	});
	
	authMySQLServer.on('error', function(err) {
		quietableLog("lost connection to authentication server.");
		
		setTimeout(connectToAuthServer,100);
	});
}

connectToAuthServer();


quietableLog("listenPort: "+listenPort);


//-----------------------------------------------------------------------------

const cnpServer = networkModule.createServer(function(cnpSocket) {

	quietableLog("client connected. waiting for authentication.");
		
	cnpSocket.setTimeout(authTimeout*1000);
	
	var authString = "";
	var authParts;
	
	var authenticationResult = function(err,result) {
		if(err) {
			quietableLog("lost connection to authentication server.");
		
			return setTimeout(function() {
				connectToAuthServer(authenticationCheck);
			},100);
		}
					
		if(result.length != 1) {
			quietableLog("client authentication timed out.");
			cnpSocket.destroy();
		} 
		
		else {
			var userRecord = result[0];
			var testHash = cryptoJS.MD5(userRecord.cnppwordsalt+authParts[1]);
			
			if(testHash == userRecord.cnppwordhash) {
				quietableLog("client authentication successful: "+userRecord.cnpusername);
				
				cnpSocket.removeListener("data",	 authenticationData);
				cnpSocket.removeListener("timeout",authenticationTimeout);
				
				addClient(new cnpClient(cnpSocket,userRecord));
			} else {
				quietableLog("client authentication failed.");
				cnpSocket.destroy();
			}
		}
	};
	
	var authenticationCheck = function() {
		authParts = authString.split("\r");
		
		if(authParts.length < 3)
			return; //wait for more data.

		authParts[0] = authParts[0].trim();
		authParts[1] = authParts[1].trim();

		authMySQLServer.query(`SELECT name,
																	cnpusername,
																	cnppwordsalt,
																	cnppwordhash
														 FROM users 
														WHERE cnpusername = ?`,
														[authParts[0]], 
														authenticationResult);
	};
	
	var authenticationData = function(data) {
		authString += data;
		authenticationCheck();
	};

	var authenticationTimeout = function() {
		quietableLog("client authentication timed out.");
		this.destroy();
	};
	
	cnpSocket.on('data',   authenticationData);
	cnpSocket.on('timeout',authenticationTimeout);
});

cnpServer.listen(listenPort);

function addClient(client) {
	var alreadyConnected = false;

	var remoteAddressPort = client.cnpSocket.remoteAddress+":"+client.cnpSocket.remotePort;

	connectedClients.forEach(function(value,index) {
		if(alreadyConnected)
			return;
		
		if(this[index] == client) {
			alreadyConnected = true;
			return;
		}
	});
	
	if(!alreadyConnected)
		connectedClients.push(client);
		
	quietableLog("client connected from: "+remoteAddressPort);
	quietableLog("total clients: "+connectedClients.length);
}

function removeClient(client) {
	var indexOfClient = connectedClients.indexOf(client);
	
	if(indexOfClient > -1) {
		connectedClients.splice(indexOfClient,1);

		quietableLog("removed client: "+client.userRecord.cnpusername);
		quietableLog("total clients: "+connectedClients.length);
	}
}

function quietableLog(msg) {
	if(!quietMode)
		console.log(msg);
}


//-----------------------------------------------------------------------------

class cnpClient {
	constructor(cnpSocket,userRecord) {
		this.cnpSocket  = cnpSocket;
		this.userRecord = userRecord;
		
		this.XSockets = [];
		
		this.packetHeaderIndex = 0;
		this.packetHeader = Buffer.alloc(4);
	
		//Current incoming packet
		
		this.packet = null;
		
		//CNP <---> C64 OS Socket Management
		
		this.cnpSocket.cnpClient = this;

		this.cnpSocket.setEncoding('binary');

		this.cnpSocket.setTimeout(socketTimeout*1000);
		
		this.cnpSocket.on('data',function(data) {
			this.cnpClient.onDataFromC64(data);
		});

		this.cnpSocket.on('timeout',function() {
			quietableLog("client connection timed out. "+this.cnpClient.userRecord.cnpusername);
		
			this.destroy();
			this.cnpClient.destruct();
		});

		this.cnpSocket.on('end',function() {
			quietableLog("client connection ended. "+this.cnpClient.userRecord.cnpusername);
		
			this.destroy();
			this.cnpClient.destruct();
		});
	}
	
	destruct() {
		removeClient(this);
	}

 	onDataFromC64(data) {
    var dataBuffer = Buffer.from(data,'binary');
    //console.log(dataBuffer);	
    
    while(dataBuffer.length) {
			if(this.packet) {
				dataBuffer = this.packet.onData(dataBuffer);
	
				if(this.packet.received)
					this.packet = null;

				if(dataBuffer.length)
					continue;
				return;
			}
	
			this.packetHeader.writeUint8(dataBuffer.readUInt8(0),this.packetHeaderIndex++);
			dataBuffer = dataBuffer.subarray(1);
		
			switch(this.packetHeader.readUInt8(0)) {
				case pt_alive:
				case pt_alive_alt:
					quietableLog("received keep alive. "+this.userRecord.cnpusername);
					this.packetHeaderIndex = 0;
				break;
			
				case pt_serv:
				case pt_open:
				case pt_data:
					if(this.packetHeaderIndex == 4) {
						this.packet = new cnpPacket(this,this.packetHeader);
						this.packet.takeAction();
						this.packetHeaderIndex = 0;
					}
				break;
				
				case pt_close:
				case pt_time:
				case pt_ack:
				case pt_nak:
					if(this.packetHeaderIndex == 2) {
						// if(this.packetHeader.readUInt8(0) == pt_close)
						// 	console.log("Received pt_close packet from C64.");
						// if(this.packetHeader.readUInt8(0) == pt_time)
						// 	console.log("Received pt_time packet from C64.");
						// if(this.packetHeader.readUInt8(0) == pt_ack)
						// 	console.log("Received pt_ack packet from C64.");
						// if(this.packetHeader.readUInt8(0) == pt_nak)
						// 	console.log("Received pt_nak packet from C64.");
					
						var packet = new cnpPacket(this,this.packetHeader);
						packet.takeAction();

						this.packetHeaderIndex = 0;
					}
				break;
				
				default: 
					this.packetHeaderIndex = 0;
					quietableLog("Unrecognized packet type: "+this.packetHeader.readUInt8(0));
				break;
			}
		}
	}
	
	processServiceMessage(dataBuffer) {
		var serviceMessage  = dataBuffer.toString("latin1");
		
		switch(serviceMessage) {
			case "ENDSESSION":
				for(var i=0;i<this.XSockets.length;i++)
					this.XSockets[i].close();

				this.XSockets = [];
				
				this.cnpSocket.destroy();
				this.destruct();
			break;
		}
	}
	
	openSocketConnection(openPacket) {
		//If a cnpXSocket for this port is already open, it's probably because
		//the C64 OS App was "killed" without closing its open socket(s). 
		//Then a new App was opened in the original App Bank and is opening
		//a new socket with that same port number. Close the old cnpXSocket.
	
		for(var i=0;i<this.XSockets.length;i++) {
			if(this.XSockets[i].port  == openPacket.port) {
				this.XSockets[i].close();
				break;
			}		
		}
	
		var xSocket = new cnpXSocket(this,openPacket.port);
		this.XSockets.push(xSocket);
	
		var address = openPacket.data.toString("utf8").split(":");
		xSocket.socket.connect(address[1],address[0]);
	}
	
	getXSocket(port) {
		for(var i=0;i<this.XSockets.length;i++) {
			if(this.XSockets[i].port == port)
				return this.XSockets[i];
		}
		
		return null;
	}

	removeXSocket(xSocket) {
		var index = this.XSockets.indexOf(xSocket);
		if(index > -1)
			this.XSockets.splice(index,1);
	}
}


//-----------------------------------------------------------------------------\

class cnpPacket {
	constructor(cnpClient,packetHeader) {
		this.cnpClient = cnpClient;
		
		this.type = packetHeader.readUInt8(0);
		this.port = packetHeader.readUInt8(1);

		this.xSocket = this.cnpClient.getXSocket(this.port);

		this.packetHeader = packetHeader;
	};
	
	takeAction() {
		switch(this.type) {
			case pt_close:
			case pt_time:
			case pt_ack:
			case pt_nak:
				if(!this.xSocket) {
					//console.log("XSocket not found. Sending timeout packet.");
					this.sendPacketType(pt_time);
					return;
				}
			break;
		}

		switch(this.type) {
			case pt_close:
				//console.log("Sending ACK packet to C64 for socket close request.");
				this.sendPacketType(pt_ack);
				//fallthrough...
			case pt_time:
				this.xSocket.close();
				return;
			break;

			case pt_ack:
				this.xSocket.gotAck();
				return;
			break;
			
			case pt_nak:
				this.xSocket.gotNak();
				return;
			break;
		}

		this.dsiz = this.packetHeader.readUInt8(2);
		this.csum = this.packetHeader.readUInt8(3);

		if(this.dsiz == 0x00)
			this.dsiz = 0x100;

		this.received = false;

		this.dataXOR   = 0x00;
		this.dataIndex = 0x00;

		this.data = Buffer.alloc(this.dsiz);
	};
	
	sendPacketType(packetType) {
		var packet = Buffer.alloc(2);

		packet.writeUInt8(packetType,0);
		packet.writeUInt8(this.port,1);

		this.cnpClient.cnpSocket.write(packet);
	};
	
	onData(dataBuffer) {
		
		while(this.dataIndex < this.dsiz && dataBuffer.length) {
			var dataByte = dataBuffer.readUInt8(0);
			
			this.dataXOR ^= dataByte;
			this.data.writeUint8(dataByte,this.dataIndex++);
			
			dataBuffer = dataBuffer.subarray(1);
		}
		
		if(this.dataIndex < this.dsiz)
			return dataBuffer;

		//Packet Fully Received.
		
		this.received = true;
		//console.log("Packet received.");

		//Trim the packet's data buffer to its data size.
		
		this.data = this.data.subarray(0,this.dsiz);

		//console.log("Packet Data: "+this.data.toString());

		//Validate the packet's checksum.	
					
		if(this.csum != this.dataXOR) {
			//console.log("Checksum failed, sending nak.");
			this.sendPacketType(pt_nak);
			
			return dataBuffer;
		}
		
		switch(this.type) {
			case pt_serv:
				this.cnpClient.processServiceMessage(this.data);
			break;
			case pt_open:
				//console.log("Opening socket. "+this.data.toString());
				this.cnpClient.openSocketConnection(this);
			break;
			case pt_data:
				if(!this.xSocket)
					this.sendPacketType(pt_time);
				else
					this.xSocket.sendData(this.data);
			break;
		}
		
		return dataBuffer;
	}
}


//-----------------------------------------------------------------------------

class cnpXSocket {
	constructor(cnpClient,port) {
		this.cnpClient = cnpClient;
		this.port      = port;
		
		this.inBuffer  = Buffer.alloc(0);

		this.lastDataPacket = null;

		//Status Flags	
		this.remoteClosed    = 0;
		this.sentClosePacket = 0;
		this.sentDataPacket  = 0;

		//Remote Socket		
		this.socket = new networkModule.Socket();
		
		this.socket.cnpXSocket = this;
		this.socket.cnpClient  = this.cnpClient;
		
		//this.socket.setEncoding('binary');
		this.socket.setTimeout(socketTimeout*1000);
		
		this.socket.on("connectionAttemptFailed", function() {
			//Results in csc_fail message in cnp.lib
			this.cnpXSocket.sendPacketType(pt_time);
		});
		
		this.socket.on("connectionAttemptTimeout",function() {
			//Results in csc_time message in cnp.lib
			this.cnpXSocket.sendPacketType(pt_time);
		});
		
		this.socket.on("connect", function() {
			//Results in csc_open message in cnp.lib
			//console.log("Sending Ack on XSocket connecting to TCP/IP.");
			this.cnpXSocket.sendPacketType(pt_ack);
		});

		this.socket.on("data", function(data) {
			this.cnpXSocket.receiveData(data);
		});

		this.socket.on("error", function() {
			//console.log("XSocket remote socket error.");
		});

		this.socket.on("close", function() {
			//console.log("XSocket remote socket closed.");
			this.cnpXSocket.remoteClosed = 1;
			
			if(this.cnpXSocket.sentDataPacket)
				return;
			
			if(this.cnpXSocket.inBuffer.length)
				return;
			
			this.cnpXSocket.sendPacketType(pt_close);
			this.cnpXSocket.sentClosePacket = 1;
		});
	}
	
	sendPacketType(packetType) {
		var packet = Buffer.alloc(2);

		packet.writeUInt8(packetType,0);
		packet.writeUInt8(this.port,1);

		this.cnpClient.cnpSocket.write(packet);
	}

	gotAck() {
		if(this.sentClosePacket) {
			//console.log("XSocket gotAck for close socket packet");
			return this.close();
		}

		if(this.sentDataPacket)	{
			//console.log("XSocket gotAck for sent data packet");
			this.sentDataPacket = 0;
		
			if(this.inBuffer.length) {
				//console.log("XSocket more data in inBuffer to send\n");
				this.prepareDataPacket();
				this.sendDataPacket();
				
				return;
			} 
			
			if(this.remoteClosed) {
				//console.log("sending close packet to C64");
				this.sendPacketType(pt_close);
				this.sentClosePacket = 1;
				
				return;
				// } else {
				// 	console.log("The remote side has not closed yet.");
			}
		}
	}

	gotNak() {
		if(this.sentClosePacket) {
			this.sendPacketType(pt_close);
			this.sentClosePacket = 1;
			
			return;
		}
		
		if(this.sentDataPacket) {
			this.sendDataPacket();
		
			return;
		}
	}
	
	receiveData(dataBuffer) {
		var totalLength = this.inBuffer.length + dataBuffer.length;
		
		this.inBuffer = Buffer.concat([this.inBuffer,dataBuffer],totalLength);
		
		if(!this.sentDataPacket) {
			this.prepareDataPacket();
			this.sendDataPacket();
		}
	}
	
	prepareDataPacket() {
		var dataByte = 0;
		var dataSize = 0;
		var dataXOR  = 0;
		
		var packetData = Buffer.alloc(0x100);
		
		while(this.inBuffer.length) {
			dataByte = this.inBuffer.readUInt8(0);
			
			dataXOR ^= dataByte;
			
			packetData.writeUint8(dataByte,dataSize++);

			this.inBuffer = this.inBuffer.subarray(1);
			
			if(dataSize == 0x100) {
				//Packet is full. Cap it here.
				dataSize = 0x00; //represents $0100 bytes of data.
				break;
			}
		}
		
		packetData = packetData.subarray(0,dataSize == 0x00?0x100:dataSize);
		
		var packetHead = Buffer.alloc(4);
		
		packetHead.writeUint8(pt_data,	0);
		packetHead.writeUint8(this.port,1);
		packetHead.writeUint8(dataSize,	2);
		packetHead.writeUint8(dataXOR,	3);
		
		this.lastDataPacket = Buffer.concat([packetHead,packetData],packetData.length+4);
	}

	//In from TCP/IP Socket, out to cnpClient
	sendDataPacket() {
		//console.log("Sending data packet to cnpSocket.");

		this.cnpClient.cnpSocket.write(this.lastDataPacket);
		this.sentDataPacket = 1;
	}
	
	//In from cnpClient, out on TCP/IP Socket
	sendData(dataBuffer) {
		//console.log("Sending data to TCP/IP Socket. "+dataBuffer.toString());
		this.socket.write(dataBuffer);
		
 		//console.log("sending ACK to C64 for data received.");
 		this.sendPacketType(pt_ack);
	}
	
	close() {
		//console.log("closing XSocket.");
		this.socket.destroy();
		this.cnpClient.removeXSocket(this);
	}
}
