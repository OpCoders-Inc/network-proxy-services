
//systemctl start c64os.images.service
//systemctl stop c64os.images.service

import fsnp from "node:fs";
import net  from "net";
import http from "http";

//JIMP Documentation
//http://jimp-dev.github.io/jimp/api/jimp/classes/jimp/

import { Jimp }						from "jimp";
import { promises as fs } from "fs";
import { v4 as uuidv4 } 	from 'uuid';

import Downloader 				from "nodejs-file-downloader";

import { search as imageSearch } from "async-image-search";

const server = net.createServer((socket) => {
	socket.setTimeout(15000);
	
	socket.on('timeout', () => {
		console.log('socket timeout');
		socket.end();
	}); 

	var requestString = "";

	socket.on("data", (data) => {
		requestString += data.toString();

		var lastByte = requestString[requestString.length-1];

		if(lastByte != "\n" && lastByte != "\r")
			return; //more data to come
		
		if(requestString[requestString.length-1] == "\n")
			requestString = requestString.substr(0,requestString.length-1);

		if(requestString[requestString.length-1] == "\r")
			requestString = requestString.substr(0,requestString.length-1);

		console.log("received request: '"+requestString+"'");

		var urlObj = parseAsURL(requestString);

		if(urlObj) {
			//The requested string is a URL, presumably to an image file.

			requestImageFile(urlObj,requestString,function(responseString) {
				socket.write(String.fromCharCode(1));
				socket.write(responseString);
				socket.destroy();
			});
		} 
		
		else {
			//The requested string is not a URL, treat as a search term.

			imageSearch(requestString).then(function(searchResults) {
				var resultRows = [];
			
				var rowComplete = function() {					
					if(searchResults.length)
						setTimeout(processNext,1);
					else {
						
						//Limit output to 40 records (10 pages)
						while(resultRows.length > 40)
							resultRows.pop();

						var pageLen = Math.ceil(resultRows.length / 4);
											
						socket.write(String.fromCharCode(pageLen));
						socket.write(resultRows.join('\n'));
						socket.destroy();
					}
				};			
			
				var processNext = function() {
					var nextResult = searchResults.shift();
			
					//Name and Extension Manipulation

					var pathparts = nextResult.url.split('#')[0].split('?')[0].split('/');
				
					do {
						if(!pathparts.length) {
							var filename  = "";
							var extension = "";
						}
				
						var filename  = pathparts.pop().split(".");
						var extension = filename.pop().toLowerCase();
					} while(filename.length < 1);

					switch(extension) {
						case "jpg":
						case "jpeg":
							extension = "jpg";
						break;

						case "tif":
						case "tiff":
							extension = "tif";
						break;

						case "png":
						case "gif":
						case "bmp":
						break;
					
						//Support WebP in the future, when the 
						//image proxy can convert WebP to JPEG.
					
						// case "webp":
						// 	extension = "wbp";
						// break;
					
						default:
							return rowComplete();
					}
			
					shortenURL(nextResult.url,function(shortURL) {

						if(!shortURL) {
							console.log(nextResult.url);
						}

						if(!filename)
							filename  = "no description";
					
						else {
							filename    = filename.join(" ").split("-").join(" ").split("_");
							var newName = [];
					
							for(var i=0;i<filename.length;i++) {
								if(filename[i].trim())
									newName.push(filename[i]);
							}
					
							filename = [...new Set(newName)].join(" ");
							
							filename = utf8ToAscii(filename);
						}
					
						filename = filename.substring(0,24).padEnd(24," ");
					
						var resolution = (nextResult.width+"x"+nextResult.height).substring(0,9).padEnd(9," ");
					
						var url = new URL(nextResult.url);

						//var url = new URL("http://aaa.bbb.ccc.com/asdf/asdf/sadf.aspx?blah");
						//url.protocol;  // "http:"
						//url.hostname;  // "aaa.bbb.ccc.com"
						//url.pathname;  // "/asdf/asdf/sadf.aspx"
						//url.search;    // "?blah"					
					
						var hostname = url.hostname.split(".");
					
						while(hostname.length > 2)
							hostname.shift();
					
						hostname = hostname.join(".").substring(0,15).padEnd(15," ");
					
						resultRows.push(shortURL+" "+hostname+" "+resolution+" "+filename+" "+extension);
						rowComplete();
					});
				};
			
				processNext();
			});
		}
	});
});

async function requestImageFile(urlObj,urlString,callback) {

	//Name and Extension Manipulation

	var pathparts = urlString.split('#')[0].split('?')[0].split('/');

	do {
		if(!pathparts.length) {
			var filename  = "";
			var extension = "";
		}

		var filename  = pathparts.pop().split(".");
		var extension = filename.pop().toLowerCase();
	} while(filename.length < 1);

	switch(extension) {
		case "jpg":
		case "jpeg":
			extension = "jpg";
		break;

		case "tif":
		case "tiff":
			extension = "tif";
		break;

		case "png":
		case "gif":
		case "bmp":
		break;

		//Support WebP in the future, when the 
		//image proxy can convert WebP to JPEG.

		// case "webp":
		// 	extension = "wbp";
		// break;

		default:
			return callback("");
	}

	const downloader = new Downloader({
		"url": 			 urlString,
		"directory": "./image-cache",
		"onBeforeSave": function(deducedName) {
			var extension = deducedName.split(".").pop();

			switch(extension) {
				case "jpeg":
					extension = "jpg";
				break;
			}

			return uuidv4()+"."+extension;
		}    
	});

	try {
		const {filePath,downloadStatus} = await downloader.download();

		const image = await Jimp.read(filePath);
	
		shortenURL(urlString,function(shortURL) {

			if(!shortURL) {
				console.log(urlString);
			}

			if(!filename)
				filename  = "no description";
	
			else {
				filename    = filename.join(" ").split("-").join(" ").split("_");
				var newName = [];
	
				for(var i=0;i<filename.length;i++) {
					if(filename[i].trim())
						newName.push(filename[i]);
				}
	
				filename = [...new Set(newName)].join(" ");
			}
	
			filename = filename.substring(0,24).padEnd(24," ");
	
			var resolution = (image.width+"x"+image.height).substring(0,9).padEnd(9," ");
	
			//var url = new URL("http://aaa.bbb.ccc.com/asdf/asdf/sadf.aspx?blah");
			//url.protocol;  // "http:"
			//url.hostname;  // "aaa.bbb.ccc.com"
			//url.pathname;  // "/asdf/asdf/sadf.aspx"
			//url.search;    // "?blah"					
	
			var hostname = urlObj.hostname.split(".");
	
			while(hostname.length > 2)
				hostname.shift();
	
			hostname = hostname.join(".").substring(0,15).padEnd(15," ");

			fsnp.unlink(filePath,function(err) {
				// if(err)
				// 	console.log("fsnp.unlink: error: "+err);
				// else
				// 	console.log("fsnp.unlink: success: "+filePath);
			});

			callback(shortURL+" "+hostname+" "+resolution+" "+filename+" "+extension);
		});				

		console.log("File downloaded");
	} catch (error) {
		//IMPORTANT: Handle a possible error. An error is thrown in case of network errors, or status codes of 400 and above.
		//Note that if the maxAttempts is set to higher than 1, the error is thrown only if all attempts fail.
		console.log("Download failed", error);
	
		callback("");
	}
}

function shortenURL(url,callback) {
	http.get("http://services.c64os.com/su?c=1&url="+encodeURIComponent(url), res => {
		let shortURL = ''

		res.on('data', chunk => {
			shortURL += chunk
		})

		res.on('end', () => {
			callback(shortURL);
		})
	});
}

function parseAsURL(string) {
  let url;
  
  try {
    url = new URL(string);
  } catch (_) {
    return false;  
  }

	if(url.protocol === "http:" || url.protocol === "https:")
		return url;

  return false;
}

function utf8ToAscii(str) {
    /**
     * ASCII contains 127 characters.
     * 
     * In JavaScript, strings is encoded by UTF-16, it means that
     * js cannot present strings which charCode greater than 2^16. Eg:
     * `String.fromCharCode(0) === String.fromCharCode(2**16)`
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMString/Binary
     */
    const reg = /[\x7f-\uffff]/g; // charCode: [127, 65535]
    const replacer = (s) => {
        const charCode = s.charCodeAt(0);
        const unicode = charCode.toString(16).padStart(4, '0');
        return `\\u${unicode}`;
    };

    return str.replace(reg, replacer);
}
server.listen(3040);
console.log("Listening on port 3040.");
