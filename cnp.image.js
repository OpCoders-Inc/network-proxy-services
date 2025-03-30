
//systemctl start c64os.image.service
//systemctl stop c64os.image.service

import fsnp  from "node:fs";
import net   from "net";
import http  from "http";

//JIMP Documentation
//http://jimp-dev.github.io/jimp/api/jimp/classes/jimp/

import { Jimp }						from "jimp";
import { promises as fs } from "fs";
import { v4 as uuidv4 } 	from 'uuid';
import { spawn } 					from 'node:child_process';
import { Buffer }  				from 'node:buffer';

import Downloader 				from "nodejs-file-downloader";

const aspectRatios = [
	1.0,	//0
	1.2,  //1
	1.25, //2
	1.33, //3
	1.5,	//4
	1.6		//5
];

const degreeRotations = [
	0,		//0
	90, 	//1
	180,	//2
	270		//3
];

const ditherModes = [
	"bayer2x2", //0
	"bayer4x4", //1
	"bayer8x8"  //2
];

const colorSpaces = [
	"xyz",    //0
	"yuv",		//1
	"rgb",		//2
	"rainbow"	//3
];

const palettes = [
	"PALette",  //0
	"colodore", //1
	"pepto",    //2
	"deekay"		//3
];

const colorSTD = 0;
const colorFLI = 1;

const resLo = 0; //160px
const resHi = 1; //320px


const server = net.createServer((socket) => {
	socket.setTimeout(15000);
	
	socket.on('timeout', () => {
		console.log('socket timeout');
		socket.end();
	}); 

	var requestString = "";

	var imageRequest = {
		"shortCode": "",
		"brightness": 0,  //Number("0x"+strHexValue)
		"contrast":   0,	//Number("0x"+strHexValue)
		
		"autocrop":  false, //!!Number("0") | !!Number("1")
		"greyscale": false, //!!Number("0") | !!Number("1")
		"invert":    false, //!!Number("0") | !!Number("1")

		"flipVert":  false, //!!Number("0") | !!Number("1")
		"flipHorz":  false, //!!Number("0") | !!Number("1")
	
		"aspectRatio": 1.0, //aspectRatios[Number("")]
		"rotation":    0,    //degreeRotations[Number("")]
		
		"dragZoom": [0,0, 39,24],  //" ".charCodeAt(0) - 32 (ASCII value from 32 to 71 inclusive)
		
		"ditherMode":  "bayer4x4", //ditherModes[Number("")]
		"ditherRadius": 32, 			 //" ".charCodeAt(0) - 32 (ASCII value from 32 to 96 inclusive)

		"colorSpace":  "rgb",			 //colorSpaces[Number("")]
		"colorMode":   colorSTD,   //Number("0") | Number("1")
		"resolution":  resLo,			 //Number("0") | Number("1")

		"palette":     "deekay",	 //palettes[Number("")]
		
		"filename": null
	};

	socket.on("data", (data) => {
		requestString += data.toString();

		//Strip all Carriage Returns.
		requestString = requestString.replaceAll("\r","");

		if(requestString.length < 2)
			return; //more data to come

		var lastByte1 = requestString[requestString.length-1];
		var lastByte2 = requestString[requestString.length-2];

		//Two LF's in a row terminate the request.

		if(lastByte1 != "\n" || lastByte2 != "\n")
			return; //more data to come
		
		console.log("received request: '"+requestString+"'");

		var requestParts = requestString.split("\n");
		
		//Only the shortCode is absolutely required, 
		//and it comes first. 
		imageRequest.shortCode = requestParts[0];
		
		for(var i=1;i<requestParts.length;i++) {
			var requestCode  = requestParts[i].slice(0,1);
			var requestValue = requestParts[i].slice(1);
		
			switch(requestCode.toLowerCase()) {
				case "b": //Brightness
					var brightness = Number("0x"+requestValue.slice(0,2));
					
					if(brightness >= 20) {
						//20 =  0.0
						//21 =  0.5
						//22 =  1.0
						//23 =  1.5
						//...
						//39 =  9.5
						//40 = 10.0
					
						imageRequest.brightness = ((brightness - 20) / 5) + 1
					}
					
					else {
						//19 = 0.995
						//18 = 0.990
						//17 = 0.985
						
						imageRequest.brightness = 1 - (20 - brightness) * 0.025;
					}
				break;
				case "c": //Contrast
					var contrast = Number("0x"+requestValue.slice(0,2));

					imageRequest.contrast = (contrast - 20) / 30;
				break;
			
				case "p": //AutoCrop
					imageRequest.autocrop 	= !!Number(requestValue[0]);
				break;
				case "g": //Greyscale
					imageRequest.greyscale 	= !!Number(requestValue[0]);
				break;
				case "i": //Invert
					imageRequest.invert 		= !!Number(requestValue[0]);
				break;
				case "v": //Flip Vertical
					imageRequest.flipVert 	= !!Number(requestValue[0]);
				break;
				case "h": //Flip Horizontal
					imageRequest.flipHorz 	= !!Number(requestValue[0]);
				break;
			
				case "a": //Aspect Ratio
					imageRequest.aspectRatio = aspectRatios[Number(requestValue[0])];
				break;
				case "r": //Rotation
					imageRequest.rotation 	= degreeRotations[Number(requestValue[0])];
				break;
			
				case "z": //DragZoom
					imageRequest.dragZoom = [
						requestValue.charCodeAt(0) - 32,
						requestValue.charCodeAt(1) - 32,
						requestValue.charCodeAt(2) - 32,
						requestValue.charCodeAt(3) - 32
					];
				break;
			
				case "d": //Dithering
					imageRequest.ditherMode 	= ditherModes[Number(requestValue[0])];
					imageRequest.ditherRadius = requestValue.charCodeAt(1) - 32;
				break;
			
				case "m": //Bitmap Mode
					imageRequest.colorSpace = colorSpaces[Number(requestValue[0])];
					//imageRequest.colorMode  = Number(requestValue[1]);
					imageRequest.colorMode  = colorSTD; //FLI is not implemented yet.
					imageRequest.resolution = Number(requestValue[2]);

					if(requestValue.length > 3)
						imageRequest.palette  = palettes[Number(requestValue[3])];
				break;
			}
		}
			
		convertImage(imageRequest,(err,result) => {
			if(err) {
				console.log(err);
				socket.destroy();
			}
			
			else {
				socket.write(result,null,() => {
					
					//console.log("result sent on socket. Closing socket.");
				
					socket.destroy();
				});
			}
		});
	});
});

async function convertImage(imageRequest,callback) {
  //Wrapping the code with an async function, just for the sake of example.

	var tempFileName;

  const downloader = new Downloader({
    "url": 			 "http://services.c64os.com/su?id="+imageRequest.shortCode,
    "directory": "./image-cache",
		"onBeforeSave": (deducedName) => {
			
			var extension = deducedName.split(".").pop();
			
			switch(extension) {
				case "jpeg":
					extension = "jpg";
				break;
			}
			
			tempFileName = uuidv4()+"."+extension;
	    
	    return tempFileName;
	  }    
  });
  
  //console.log(imageRequest);
  
  try {
    const {filePath,downloadStatus} = await downloader.download();
    
		//console.log("downloaded file: ",filePath);    
		//console.log(downloadStatus);

		var scaleToFit = function(withResize) {
			var srcAspectRatio = image.width / image.height;
			var dstAspectRatio = imageRequest.aspectRatio;
		
			if(srcAspectRatio < 1/dstAspectRatio) {
				//Portrait
				image.contain({ "w": image.height * dstAspectRatio, "h": image.height});
				if(withResize)
					image.resize( { "w": image.height, "h": image.height * (200/320)});
			}
	
			else if(srcAspectRatio > 1/dstAspectRatio) {
				//Landscape
				image.contain({ "w": image.width * dstAspectRatio, "h": image.width});
				if(withResize)
					image.resize( { "w": image.width, "h": image.width * (200/320)});
			}
		};

		const image = await Jimp.read(filePath);
		
		if(imageRequest.flipVert || imageRequest.flipHorz) {
			image.flip({"vertical":	  imageRequest.flipVert, 
									"horizontal": imageRequest.flipHorz});
		}

		if(imageRequest.invert)
			image.invert();

		if(imageRequest.brightness)
			image.brightness(imageRequest.brightness);

		if(imageRequest.contrast)
			image.contrast(imageRequest.contrast);

		if(imageRequest.greyscale)
			image.greyscale();

		if(imageRequest.rotation)
			image.rotate(imageRequest.rotation);

		//Autocrop comes last because other adjustments
		//may lead to the border becoming a uniform color.

		if(imageRequest.autocrop)
			image.autocrop();

		//I don't know how useful this is, considering the resolution reduction to C64.
		//image.blur(2);
		
		//scaleToFit();

		var crop = imageRequest.dragZoom;

		if(crop[0] != 0  || 
			 crop[1] != 0  || 
			 crop[2] != 39 || 
			 crop[3] != 24) {
		
			scaleToFit(false);
			
			var cropX1 = crop[0];
			var cropX2 = crop[2];
		
			if(cropX1 > cropX2) {
				var temp = cropX2;
				cropX2 = cropX1;
				cropX1 = temp;
			}
		
			var cropY1 = crop[1];
			var cropY2 = crop[3];

			if(cropY1 > cropY2) {
				var temp = cropY2;
				cropY2 = cropY1;
				cropY1 = temp;
			}

			var cropWidth  = (cropX2 - cropX1 + 1) / 40;
			var cropHeight = (cropY2 - cropY1 + 1) / 25;
		
			var cropOrigX  = cropX1 / 40;
			var cropOrigY  = cropY1 / 25;

			// console.log("cropWidth ",cropWidth);
			// console.log("cropHeight ",cropHeight);
			// console.log("cropOrigX ",cropOrigX);
			// console.log("cropOrigY ",cropOrigY);

			image.crop({
				"w":image.width  * cropWidth,
				"h":image.height * cropHeight,

				"x":image.width  * cropOrigX,
				"y":image.height * cropOrigY
			});
		}

		scaleToFit(true);

		image.resize({ "w": 320, "h": 200});

 		await image.write("./image-cache/small."+tempFileName);
    
    //--nomaps retropixels forces a single color. Perfect for hires greyscale.

		let params = ["-s","fit",
									"-m","bitmap",
									"-d",imageRequest.ditherMode,
									"-r",imageRequest.ditherRadius+"",
									"-c",imageRequest.colorSpace,
									"-p",imageRequest.palette];

		if(imageRequest.greyscale && imageRequest.resolution == resHi)
			params.push("--nomaps");
			
		switch(imageRequest.resolution) {
			case resHi:
				imageRequest.filename = "./image-cache/"+tempFileName+".art";
				params.push("-h");
			break;
			case resLo:
				imageRequest.filename = "./image-cache/"+tempFileName+".koa";
			break;
		}

		params.push("-o");
		params.push(imageRequest.filename);
									
		params.push("./image-cache/small."+tempFileName);

		const retropixels = spawn('retropixels',params);

		// retropixels.stdout.on('data', (data) => {
		// 	console.log(`stdout: ${data}`);
		// });
		// 
		// retropixels.on('close', (code) => {
		// 	console.log(`child process close all stdio with code ${code}`);
		// });

		retropixels.on('exit', (code) => {

			fsnp.unlink("./image-cache/"+tempFileName,(err) => {
				if(err)
					console.log("fsnp.unlink: error: "+err);
			});

			fsnp.unlink("./image-cache/small."+tempFileName,(err) => {
				if(err)
					console.log("fsnp.unlink: error: "+err);
			});

			//console.log(`child process exited with code ${code}`);
			//console.log("All done");
			
			var imageFile = fsnp.open(imageRequest.filename,"r",0o111,(err,fd) => {
				if(err)
				  return callback("File open failed");
				
				if(imageRequest.colorMode == colorSTD) {
					switch(imageRequest.resolution) {
						case resLo:
							//Koala Format
							var bufferSize = 8000 + //Bitmap Data
															 1000 + //Screen Memory
															 1000 + //Color Memory
															 1;     //Background Color
						break;
						case resHi:
							//Art Studio Format
							var bufferSize = 8000 + //Bitmap Data
															 1000 + //Screen Memory
															 1;     //Border Color
						break;
					}

					var fileBuffer = Buffer.alloc(bufferSize,0x00,"binary");
		
					var readDone = function(fd) {
						fsnp.close(fd);
					
						fsnp.unlink(imageRequest.filename,(err) => {
							if(err)
								console.log("fsnp.unlink: error: "+err);
						});
					
						if(err)
							return callback("Failed to read from file");
							
						//console.log("Converted file read in, returning fileBuffer");	
							
						callback(null,fileBuffer);
					};

					var totalRead = 0;

					//Reads happen in asynchronous chunks.

				 	fsnp.read(fd, 				//File to read from
				 						fileBuffer, //Buffer to read into
				 						0x00,				//Offset in buffer to write to
				 						bufferSize,	//Data size in bytes to read
				 						0x02,				//Offset in file to read from

				 						(err,bytesRead,buffer) => {

				 		totalRead += bytesRead;

				 		if(totalRead == bufferSize)
				 			readDone(fd);
				 	});			
				}
			});
		});

  } catch (error) {
    //IMPORTANT: Handle a possible error. An error is thrown in case of network errors, or status codes of 400 and above.
    //Note that if the maxAttempts is set to higher than 1, the error is thrown only if all attempts fail.
    //console.log("Download failed", error);
    
    callback(error);
  }
}

server.listen(3050);
console.log("Listening on port 3050.");
