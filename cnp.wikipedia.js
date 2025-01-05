const fs 			= require("fs");
const net     = require("net");
const http    = require("http");
const https   = require("https");
const cache 	= require('node-file-cache');
const jsdom   = require("jsdom");

const { JSDOM } = jsdom;

const ELEMENT_NODE = 1;
const TEXT_NODE    = 3;

//TODO: Gracefully handle articles with more than partCodes.length parts.

const partCodes = ["0","1","2","3","4","5","6","7","8","9",
									 ":",";","<","=",">","?","@","A","B","C",
									 "D","E","F","G","H","I","J","K","L","M",
									 "N","O","P","Q","R","S","T","U","V","W",
									 "X","Y","Z","[","\\","]","^","_"];

const server = net.createServer((socket) => {
	socket.setTimeout(15000);
	
	socket.on('timeout', () => {
		console.log('socket timeout');
		socket.end();
	}); 

	var strData = "";

	socket.on("data", (data) => {
		strData += data.toString();

		var requestComplete = false;

		if(strData[strData.length-1] == "\n") {
			strData = strData.substr(0,strData.length-1);
			requestComplete = true;
		}

		if(strData[strData.length-1] == "\r") {
			strData = strData.substr(0,strData.length-1);
			requestComplete = true;
		}

		if(requestComplete) {
			var partCode = strData.substr(0,1);
			var langCode = strData.substr(1,2);
			var topic    = strData.substr(3);
		
			// console.log("received request: \n"+
			// 						 "partCode: '"+partCode+"'\n"+
			// 						 "language: '"+langCode+"'\n"+
			// 						 "topic: '"+topic+"'");

			getArticle(topic, partCode, langCode, function(output) {
				output = Buffer.from(output+String.fromCharCode(0),"binary");

				for(var i=0;i<output.length;i++) {
					var intValue = output.readUInt8(i);
					if(intValue >= 14 && intValue <= 22)
						output.writeUInt8(intValue + 226,i);
				}
				
				// console.log("content size: ",output.length);
			
				var pageLen = Math.ceil(output.length / 256);
			
				socket.write(String.fromCharCode(pageLen));
				socket.write(output);
				socket.destroy();
			});
		}
	});
});

server.listen(3030);
console.log("Listening on port 3030.");

var languageCaches = {
	"en": cache.create({"life":60*60*8,"file":"wikipedia-cache/en-wikipedia.cache.json"}),
	"de": cache.create({"life":60*60*8,"file":"wikipedia-cache/de-wikipedia.cache.json"}),
	"eo": cache.create({"life":60*60*8,"file":"wikipedia-cache/eo-wikipedia.cache.json"}),
	"es": cache.create({"life":60*60*8,"file":"wikipedia-cache/es-wikipedia.cache.json"}),
	"fr": cache.create({"life":60*60*8,"file":"wikipedia-cache/fr-wikipedia.cache.json"}),
	"it": cache.create({"life":60*60*8,"file":"wikipedia-cache/it-wikipedia.cache.json"})
};


var emojiDatabase = null;
var utf8Database  = null;

var transliterationDatabases = {
	"en": {},
	"de": {},
	"eo": {},
	"es": {},
	"fr": {},
	"it": {}
};
	
fs.readFile("./utilities/emoji2text.json", "utf8", function(error, data) {
  if(error) {
    console.log(error);
    return;
  }
  
  emojiDatabase = JSON.parse(data);
});

fs.readFile("./utilities/utf8toascii.json", "utf8", function(error, data) {
  if(error) {
    console.log(error);
    return;
  }
  
  utf8Database = JSON.parse(data);
});

fs.readFile("./utilities/utf8toascii_en.json", "utf8", function(error, data) {
  if(error) {
    console.log(error);
    return;
  }
  
  transliterationDatabases["en"] = JSON.parse(data);
});

fs.readFile("./utilities/utf8toascii_de.json", "utf8", function(error, data) {
  if(error) {
    console.log(error);
    return;
  }
  
  transliterationDatabases["de"] = JSON.parse(data);
});

fs.readFile("./utilities/utf8toascii_eo.json", "utf8", function(error, data) {
  if(error) {
    console.log(error);
    return;
  }
  
  transliterationDatabases["eo"] = JSON.parse(data);
});

fs.readFile("./utilities/utf8toascii_fr.json", "utf8", function(error, data) {
  if(error) {
    console.log(error);
    return;
  }
  
  transliterationDatabases["fr"] = JSON.parse(data);
});



function utf8toAscii(src, langCode) {
	for(var i in emojiDatabase) {
		try {
			var replacer = new RegExp(i,'g');
			src = src.replace(replacer,"{"+emojiDatabase[i]+"}");
		} catch(e) {}
	}

	var languageDatabase = transliterationDatabases[langCode];

	for(var i in languageDatabase) {
		var replacer = new RegExp(i,'g');
		src = src.replace(replacer,languageDatabase[i]);
	}

	for(var i in utf8Database) {
		var replacer = new RegExp(i,'g');
		src = src.replace(replacer,utf8Database[i]);
	}

	return src;
}


//--------------------------------------------------------

function getArticle(topic,partCode,langCode,contentCallback) {

	const virtualConsole = new jsdom.VirtualConsole();

	virtualConsole.sendTo(console, { omitJSDOMErrors: true });

	virtualConsole.on("jsdomError", (err) => {
		if(err.message !== "Could not parse CSS stylesheet") {
			console.error(err);
		}
	});

	if(["en","de","eo","es","fr","it"].indexOf(langCode) == -1)
		langCode = "en";

	var articleContent = languageCaches[langCode].get(partCode+topic.toLowerCase());

	if(articleContent) {
		contentCallback(articleContent);
		return;
	}

	//-----------------------------
	
	var httpVars = {
		host: langCode+".wikipedia.org",
		port: 443,
		path: "/wiki/"+encodeURIComponent(topic)
	};

	var htmlContent  = "";
	var errorContent = "";

	var makeRequest = function(requestCallback) {
		https.get(httpVars,function(res) {
			res.setEncoding("utf8");
	
			switch(res.statusCode) {
				case 301: //Response Redirect
					// https://en.wikipedia.org/wiki/Richard_dawkins
					var parts = res.headers.location.split("//");
					
					// en.wikipedia.org/wiki/Richard_dawkins
					parts = parts[1].split("/");
					parts.shift();
					
					httpVars.path = "/"+parts.join("/");
					
					setTimeout(function() {
						makeRequest(requestCallback);
					},5);
				break;
				case 200: //Response OK
					// console.log('unhandled statusCode:', res.statusCode);
					// console.log('headers:', res.headers);
					
					htmlContent = "";
					
					res.on("data", function(data) {
						htmlContent += data;
					});

					res.on("end",requestCallback);
			  break;
				case 404: //Page Note Found
				default:
					errorContent = topic+"\n\n"+
					
					"Wikipedia does not have an article with this exact name. "+
					"Please search again for alternative titles or spellings.\n\n"+

					"Other reasons this message may be displayed:\n"+
					"If a page was recently created here, it may not be visible yet because "+
					"of a delay in updating the database; wait a few minutes and try again.\n\n"+
					
					"Titles on Wikipedia are case sensitive except for the first character; "+
					"please check alternative capitalizations.\n\n"+

					"The page may have been deleted.";
				
					requestCallback();
				break;
			}
		});
	};
		
	//-----------------------------
		
	var processHTMLContent = function(partCode,dom,requestCallback) {	
		var responseContent = "";
		var bodyContent = dom.window.document.querySelector("div#bodyContent div#mw-content-text > div:first-child");

		if(!bodyContent) {
			// console.log("Unable to find bodyContent node.");
			requestCallback(responseContent);
			return;
		}
		
		var stripStyles = function(node) {
			var styleTags = node.getElementsByTagName('style');
		
			for(var i=0;i<styleTags.length;i++)
				styleTags[i].parentNode.removeChild(styleTags[i]);

			return node;		
		};
	
		var listLevel = function(node,indent) {
			var items = node.querySelectorAll(":scope > li");
		
			for(var j=0;j<items.length;j++) {
				var item = items[j];
				var bullet = "* ";
				if(node.nodeName.toLowerCase() == "ol")
					bullet = (j+1)+" ";
			
				var liContent = blockNode(item);
				if(liContent)
					responseContent += indent+bullet+liContent+"\n\n";
			
				var subList = item.querySelector("ul");
				if(subList)
					listLevel(subList,indent+"  ");

				var subList = item.querySelector("ol");
				if(subList)
					listLevel(subList,indent+"  ");
			}
		};
		
		var blockNode = function(node) {
			node = stripStyles(node);
		
			var textSegments = [];
			
			for(var cn=0;cn<node.childNodes.length;cn++) {
				childNode = node.childNodes[cn];
			
				switch(childNode.nodeType) {
					case ELEMENT_NODE:
						switch(childNode.nodeName.toLowerCase()) {
							case "b":
								textSegments.push(String.fromCodePoint(241-226)+
																	childNode.textContent+
																	String.fromCodePoint(240-226));
							break;
							case "em":
							case "i":
								textSegments.push(String.fromCodePoint(242-226)+
																	childNode.textContent+
																	String.fromCodePoint(240-226));
							break;
							case "span":
								textSegments.push(childNode.textContent);
							break;
							case "a":
								var hrefParts = childNode.attributes["href"].value.split("/");
							
								if(hrefParts[0] == "" && hrefParts[1] == "wiki") {
									var searchTerm = hrefParts[2].split("_").join(" ");
									
									textSegments.push(String.fromCodePoint(243-226)+
																		childNode.textContent+
																		String.fromCodePoint(2)+
																		"WS:"+searchTerm+
																		String.fromCodePoint(3));
								}
								
								else {
									textSegments.push(childNode.textContent);
								}
							break;
						}
					break;
					case TEXT_NODE:
						textSegments.push(childNode.textContent);
					break;
				}
			}
		
			return textSegments.join("").trim();
		};
		
		switch(partCode) {
			case "*": { //Get the whole article in one request
				for(var i=0;i<bodyContent.childNodes.length;i++) {
					var node = bodyContent.childNodes[i];
			
					do {
						var deeper = false;
				
						switch(node.nodeName.toLowerCase()) {
							case "h2":
								var headline = node.querySelector("span.mw-headline");
								if(headline)
									responseContent += headline.textContent.trim().toUpperCase()+"\n\n";
								else
									responseContent += node.textContent.trim().toUpperCase()+"\n\n";
							break;
							case "h3":
								var headline = node.querySelector("span.mw-headline");
								if(headline)
									responseContent += " - "+headline.textContent.trim()+"\n\n";
								else
									responseContent += " - "+node.textContent.trim()+"\n\n";
							break;
				
							case "p":
								node = stripStyles(node);
							
								var pContent = node.textContent.trim();
								if(pContent)
									responseContent += pContent+"\n\n";
							break;

							// case "ul":
							// 	listLevel(node," ");
							// break;
							// 
							// case "div":
							// 	node = node.firstElementChild;
							// 	if(node)
							// 		deeper = true;
							// break;
						}
					} while(deeper);
				}
			break; }

			case "!": { //Get only the TOC by H2 and H3 tags
				responseContent += topic+"\n";
			
				var headings = bodyContent.querySelectorAll("h2, h3");
				
				for(var i=0;i<headings.length;i++) {
					var node = headings[i];
					
					switch(node.nodeName.toLowerCase()) {
						case "h2":
							var headline = node.querySelector("span.mw-headline");

							if(headline)
								responseContent += headline.textContent.trim().toUpperCase()+"\n";
							else 
								responseContent += node.textContent.trim().toUpperCase()+"\n";
						break;

						case "h3":
							var headline = node.querySelector("span.mw-headline");

							if(headline)
								responseContent += " - "+headline.textContent.trim()+"\n";
							else 
								responseContent += " - "+node.textContent.trim()+"\n";
						break;
					}
				}
			break; }
			
			default: {
				var partCodeVal = partCode.charCodeAt(0);

				partCodeVal -= 48;
			
				if(partCodeVal == 0) {
					var mainHeading = dom.window.document.querySelector("main#content header h1");
					if(!mainHeading)
						mainHeading = dom.window.document.querySelector("div#content h1#firstHeading");
				
					var pageTitle = mainHeading.textContent.trim();
					if(pageTitle)
						responseContent = pageTitle+"\n\n";
				}

				var stop = false;
			
				for(var i=0;i<bodyContent.childNodes.length;i++) {
					var node = bodyContent.childNodes[i];
			
					do {
						var deeper = false;
				
						switch(node.nodeName.toLowerCase()) {
							case "h2":
								if(!partCodeVal) {
									stop = true;
									break;
								}
							
								partCodeVal--;
							
								if(!partCodeVal) {
									var headline = node.querySelector("span.mw-headline");
									if(headline)
										responseContent += headline.textContent.trim().toUpperCase()+"\n\n";
									else
										responseContent += node.textContent.trim().toUpperCase()+"\n\n";
								}
							break;
							case "h3":
								if(!partCodeVal) {
									stop = true;
									break;
								}

								partCodeVal--;
							
								if(!partCodeVal) {
									var headline = node.querySelector("span.mw-headline");
									if(headline)
										responseContent += " - "+headline.textContent.trim()+"\n\n";
									else
										responseContent += " - "+node.textContent.trim()+"\n\n";
								}
							break;
				
							case "p":
								if(!partCodeVal) {
									var pContent = blockNode(node);

									if(pContent)
										responseContent += pContent+"\n\n";
								}
							break;

							case "ul":
							case "ol":
								if(!partCodeVal)
									listLevel(node," ");
							break;
				
							case "div":
							case "span":
							case "blockquote":
								node = node.firstElementChild;
								if(node)
									deeper = true;
							break;
						}
					} while(deeper);
					
					if(stop)
						break;
				}
			break; }
		}

		requestCallback(responseContent);
	};
	
	//-----------------------------

	makeRequest(function() {
		if(errorContent && !htmlContent) {
			if(partCode == "!")
				contentCallback("Article Not Found\n");
			else
				contentCallback(errorContent);
			
			return;
		}
	
		var dom = new JSDOM(htmlContent,{ virtualConsole });

		processHTMLContent(partCode,dom,function(responseContent) {
			responseContent = utf8toAscii(responseContent,langCode);
			
			languageCaches[langCode].set(partCode+topic.toLowerCase(),responseContent);
			contentCallback(responseContent);

			//Fetch and Cache Table of Contents
			
			processHTMLContent("!",dom,function(cacheContent) {
				cacheContent = utf8toAscii(cacheContent,langCode);
				languageCaches[langCode].set("!"+topic.toLowerCase(),cacheContent);

				var partCount = cacheContent.split("\n").length-1;
				var i = 1;
	
				var fetchNextPart = function() {
					var partCode = partCodes[i];
				
					processHTMLContent(partCode,dom,function(cacheContent) {
						languageCaches[langCode].set(partCode+topic.toLowerCase(),utf8toAscii(cacheContent,langCode));

						i++;
						partCheck();
					});
				};

				var partCheck = function() {
					if(i < partCount)
						setTimeout(fetchNextPart,1);
					else {
						dom.window.close();
						global.gc();
					}
				};
	
				partCheck();
			});
		});
	});
		
}
