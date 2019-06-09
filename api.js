/**
 * Import fs for cheking file size and existence
 */
const fs = require('fs');
/**
 * Import path for getting the name of a file to be uploaded
 */
const path = require('path');
/**
 * Module for web requests
 */
const request = require('request');
/**
 * Low level nodejs web request module over https
 */
const https = require('https');
/**
 * API logging utility getter
 */
const { getAPILogger } = require('./logging');
// const httpsProxy = require('./https-proxy'); // For debugging purposes
/**
 * History of visited folders
 */
let pathStack = [];
/**
 * Store session id and local storage data
 */
let tokens = {};
/**
 * Store username and password for auto re-login in case of a session timeout
 */
let creds = {};
/**
 * Indicates whether the API should print debug messages
 */
let log = getAPILogger();
/**
 * Host to send the requests to
 */
let wdHost = '';

/**
 * Login to your wdc device
 * @param {String} username The username to use for wdc login
 * @param {String} password The password to use for wdc login
 */
function login(username, password) {
    return new Promise((resolve) => {
        const authUrl = 'https://wdc.auth0.com/oauth/ro';
        const wdcAuth0ClientID = '56pjpE1J4c6ZyATz3sYP8cMT47CZd6rk';
        request.post(authUrl, {
            body: JSON.stringify({ // Auth0 specific request, copied from the wdc login request to the authUrl endpoint
                client_id: wdcAuth0ClientID,
                connection: 'Username-Password-Authentication',
                device: '123456789',
                grant_type: 'password',
                password: password,
                username: username,
                scope: 'openid offline_access',
            }),
            headers: {
                'content-type': 'application/json',
            }
        }, (error, response, body) => {
            if (response.statusCode === 401) {
                resolve(false);
                return;
            }
            if (error) {
                log.fatal('Error occurred while authenticating to server');
                log.error(error);
                resolve(false);
                return;
            }
            tokens.auth = 'Bearer ' + JSON.parse(body).id_token; // Save the Bearer authorization token
            resolve(true);
        });
    });
}

/**
 * List files in a specific folder
 * @param {String} authToken The authentication token
 * @param {String} subPath The folder to list the entries of
 */
function ls(authToken, subPath) {
    return new Promise((resolve) => {
        const listFilesUrl = `https://${wdHost}.remotewd.com/sdk/v2/filesSearch/parents?ids=${subPath}&fields=id,mimeType,name&pretty=false&orderBy=name&order=asc`;
        request.get(listFilesUrl, { headers: { 'authorization': authToken } }, (error, response, body) => {
            if (response.statusCode === 401) {
                resolve({ success: false, error: undefined, session: false });
                return;
            }
            if (error) {
                log.fatal('Something went wrong');
                log.debug('Status code: ' + response.statusCode);
                log.error(error);
                resolve({ success: false, error: error, session: true });
                return;
            }
            const obj = JSON.parse(body);
            if (obj.files === undefined) {
                resolve({ success: true, error: undefined, session: true, result: [] });
                return;
            }
            const parsedResult = JSON.parse(body).files.map(item => {
                return {
                    name: item.name,
                    id: item.id,
                    isDir: item.mimeType == 'application/x.wd.dir',
                };
            });
            resolve({ success: true, error: undefined, session: true, result: parsedResult });
        });
    });
}

/**
 * Create a new directory in the specified directory
 * @param {String} authToken The authentication token
 * @param {String} subPath The folder to create the new folder in
 * @param {String} folderName The name of the new folder
 */
function mkdir(authToken, subPath, folderName) {
    return new Promise((resolve) => {
        const mkdirUrl = `https://${wdHost}.remotewd.com/sdk/v2/files?resolveNameConflict=true`;
        request.post(mkdirUrl, {
            headers: { 'authorization': authToken }, multipart: [
                {
                    body: JSON.stringify({ // Directory creation parameters copied from wdc request to mkdirUrl endpoint
                        'name': folderName,
                        'parentID': subPath,
                        'mimeType': 'application/x.wd.dir',
                    })
                }
            ]
        }, (error, response) => {
            if (response.statusCode === 401) {
                resolve({ success: false, error: undefined, session: false });
                return;
            }
            if (error) {
                log.fatal('Something went wrong');
                log.debug('Status code: ' + response.statusCode);
                log.error(error);
                resolve({ success: false, error: error, session: true });
                return;
            }

            const locationParts = response.headers['location'].split('/'); // ID of the new folder gets sent in the location header
            resolve({ success: true, error: undefined, session: true, result: locationParts[locationParts.length - 1] });
        });
    });
}

/**
 * Send multipart request to the wdc device
 * @param {String} mpData Multipart mixed data to send
 * @param {String} auth Authentication token
 */
function multipartMixed(mpData, auth) {
    return new Promise((resolve) => {
        // process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0; // Required for https proxy debugging
        const boundary = '3cb3d25a-a9b9-4906-a267-9b65ae299d0f'; // Some random boundary I copied from one of the delete folder requests
        const data = `--${boundary}\r\n${mpData}\r\n--${boundary}--`;
        // const proxyAgent = new httpsProxy({proxyHost: 'localhost', proxyPort: 8080});
        // NodeJS https module request options
        const options = {
            hostname: `${wdHost}.remotewd.com`,
            port: 443,
            path: '/sdk/v1/batch',
            method: 'POST',
            headers: {
                'authorizaiton': auth,
                'content-type': 'multipart/mixed; boundary=' + boundary,
                'content-length': Buffer.byteLength(data),
            },
            // agent: proxyAgent,
        };

        const req = https.request(options, (response) => {
            if (response.statusCode === 401) {
                resolve({ success: false, error: undefined, session: false });
                return;
            }
            let currentData = '';

            response.on('data', d => { // Collect response data
                currentData += d;
            });

            response.on('error', (error) => { // Check for errors
                log.fatal('Something went wrong');
                log.debug('Status code: ' + response.statusCode);
                log.error(error);
                resolve({ success: false, error: error, session: true });
            });
            response.on('end', () => resolve({ success: true, error: undefined, session: true, status: response.statusCode, content: currentData })); // Response finished
        });
        req.write(data); // Send the data to the server
        req.end(); // Finish sending the data
    });
}

/**
 * Remove an entry from the wdc
 * @param {String} authToken The authenticaiton token
 * @param {String} entryID The ID of the entry to remove
 */
function rm(authToken, entryID) {
    return new Promise(async (resolve) => {
        // Request body copied from a folder delete request
        const postBody = `Content-Id: 0\r\n\r\nDELETE /sdk/v2/files/${entryID} HTTP/1.1\r\nHost: ${wdHost}.remotewd.com\r\nAuthorization: ${authToken}\r\n\r\n`;
        // Send multipart/mixed to the server (since request module doesn't support the /mixed multipart MIME)
        const result = await multipartMixed(postBody, authToken);
        if (!result.success) resolve(result);
        else resolve({ success: result.status == 200, error: undefined, session: true, result: true });
    });
}

/**
 * Format the time based on the cloud's format for mTime in the file upload request
 * WARNING: the GMT time offset is hardcoded to +02:00 for now
 */
function getFormattedTime() { // TODO: set the GMT offset dynamically
    const date = new Date();
    // 0 prefix function
    const pf = (input) => {
        if (input.toString().length < 2) return '0' + input.toString();
        return input;
    };
    const result = `${date.getFullYear()}-${pf(date.getMonth() + 1)}-${pf(date.getDate())}T${pf(date.getHours())}:${pf(date.getMinutes())}:${pf(date.getSeconds())}+02:00`;
    return result;
}

/**
 * Upload a file to the wdc
 * @param {String} authToken The authentication token
 * @param {String} subPath The folder ID to upload the file to
 * @param {String} pathToFile Path to the file on the local system
 * @param {Function} reportCompleted Function to call with current offset
 * @param {Function} reportDone Function to call when the upload is done
 */

function upl(authToken, subPath, pathToFile, reportCompleted, reportDone) {
    // Start new file upload
    const startUpload = (activityID) => {
        const initUploadUrl = `https://${wdHost}.remotewd.com/sdk/v2/files/resumable?resolveNameConflict=1&done=false`;
        request.post(initUploadUrl, {
            headers: {
                'authorization': authToken,
                'x-activity-tag': activityID,
            },
            multipart: [
                {
                    body: JSON.stringify({ // Request copied from a file upload request to the initUploadUrl endpoint
                        name: path.basename(pathToFile),
                        parentID: subPath,
                        mTime: getFormattedTime(),
                    })
                },
                { body: '' }
            ]
        }, (error, response) => {
            if (response.statusCode === 401) {
                reportDone({ success: false, error: undefined, session: false });
                return;
            }
            if (error) {
                log.fatal('Something went wrong');
                log.debug('Status code: ' + response.statusCode);
                log.error(error);
                reportDone({ success: false, error: error, session: true });
                return;
            }
            const fileUrl = `https://${wdHost}.remotewd.com${response.headers['location']}/resumable/content`;
            uploadManual({ authorization: authToken, xActivityTag: activityID, url: fileUrl }, reportCompleted, reportDone, pathToFile); // Upload the file to the server
        });
    };

    // Start activity and get its ID
    const startActivity = () => {
        request.post(`https://${wdHost}.remotewd.com/sdk/v1/activityStart`, { headers: { 'authorization': authToken } }, (error, response, body) => {
            if (response.statusCode === 401) {
                resolve({ success: false, error: undefined, session: false });
                return;
            }
            if (error) {
                log.fatal('Something went wrong');
                log.debug('Status code: ' + response.statusCode);
                log.error(error);
                reportDone({ success: false, error: error, session: true });
                return;
            }
            const activityTag = JSON.parse(body).tag;
            startUpload(activityTag); // Init the upload of the file
        });
    };

    startActivity();
}

/**
 * Yield the specified file's content in blocks
 * @param {String} filePath The path ofthe file on the local system
 */
function* getFileContent(filePath) {
    let currentOffset = 0;
    const totalSize = fs.statSync(filePath).size;
    const bufferSize = 20480; // Block size, each loop reads this many bytes
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(bufferSize); // Buffer to read file contents to
    while (true) {
        if (currentOffset >= totalSize) break;
        const bytesRead = fs.readSync(fd, buffer, 0, bufferSize, currentOffset > totalSize ? currentOffset - totalSize : currentOffset);
        const isDone = bytesRead != bufferSize; // EOF
        yield { buffer, bytesRead, currentOffset, isDone };
        if (isDone) break;
        currentOffset += bytesRead;
    }
}

/**
 * Upload file to the server in chunks
 * @param {Object} data Object with requested header and url data for uploading
 * @param {Function} progressCallback Function to call with the current offset
 * @param {Function} doneCallback Function to call when the upload is done
 * @param {String} filePath The path of the file on the local system
 */
async function uploadManual(data, progressCallback, doneCallback, filePath) {
    for (const { buffer, bytesRead, currentOffset, isDone } of getFileContent(filePath)) {
        const currentUrl = `${data.url}?offset=${currentOffset}&done=${isDone}`; // Construct endpoint url
        progressCallback(currentOffset); // Update upload progress
        // Convert request callback to awaitable promise
        const uploadBytes = () => {
            return new Promise((resolve) => {
                request.put(currentUrl, { headers: { 'authorization': data.authorization, 'x-activity-tag': data.xActivityTag }, body: buffer.slice(0, bytesRead) }, (error, response) => {
                    if (response.statusCode === 401) {
                        resolve({ success: false, error: undefined, session: false });
                        return;
                    }
                    if (error) {
                        log.fatal('Something went wrong');
                        log.debug('Status code: ' + response.statusCode);
                        log.error(error);
                        reportDone({ success: false, error: error, session: true });
                        return;
                    }
                    resolve({ success: true, error: undefined, session: true });
                });
            });
        };
        const uploadResult = await uploadBytes(); // Upload chunk
        if (!uploadResult.success) {
            doneCallback(uploadResult);
            break;
        }
        if (isDone) doneCallback({ success: true, error: undefined, session: true, result: true }); // Upload is done
    }
}

/**
 * Get the size of a file on the wdc
 * @param {String} authToken The authentication token
 * @param {String} fileID The ID of the file to get the size of
 */
function getFileSize(authToken, fileID) {
    return new Promise((resolve) => {
        const dataUrl = `https://${wdHost}.remotewd.com/sdk/v2/files/${fileID}?pretty=false&fields=size`; // Endpoint to get the size of the file
        request.get(dataUrl, { headers: { 'authorization': authToken } }, (error, response, body) => {
            if (response.statusCode === 401) {
                resolve({ sucess: false, error: undefined, session: false });
                return;
            }
            if (error) {
                log.fatal('Something went wrong');
                log.debug('Status code: ' + response.statusCode);
                log.error(error);
                resolve({ success: false, error: error, session: true });
                return;
            }
            resolve({ success: true, error: undefined, session: true, result: JSON.parse(body).size }); // Get the size of the file from the response
        });
    });
}

/**
 * Download a file to the local file system
 * @param {String} authToken The authentication token
 * @param {String} fileID The ID of the file
 * @param {String} localPath The path of the local file to download to
 * @param {Function} progressCallback Function to call with offset and total size
 */
function dwl(authToken, fileID, localPath, progressCallback) {
    return new Promise(async (resolve) => {
        const downloadUrl = `https://${wdHost}.remotewd.com/sdk/v2/files/${fileID}/content?download=true&access_token=${authToken.substring(7)}`;
        let totalSize = 0;
        const sizeData = await getFileSize(authToken, fileID);
        if (!sizeData.success) {
            resolve(sizeData);
            return;
        }
        totalSize = sizeData.result;
        const req = request.get(downloadUrl);
        let currentOffset = 0;

        req.on('response', (response) => {
            if (response.statusCode === 401) {
                resolve({ sucess: false, error: undefined, session: false });
            }
        });

        req.on('error', (error) => {
            log.fatal('Something went wrong');
            log.debug('Status code: ' + response.statusCode);
            log.error(error);
            resolve({ success: false, error: error, session: true });
        });

        req.on('data', (chunk) => {
            fs.appendFileSync(localPath, chunk);
            progressCallback({ offset: currentOffset, total: totalSize });
            currentOffset += chunk.length;
        });

        req.on('end', () => resolve({ success: true, error: undefined, session: true, result: true }));
    });
}

/**
 * Enter to a directory on the server, equivalent to 'cd' command with relative path
 * @param {String} folderID The ID of the folder to enter to
 */
function enterDirectory(folderID) {
    if (folderID === undefined) return;
    pathStack.push(folderID);
}

/**
 * Enters a directory, but also clears the previous directory list
 * @param {String} path The ID of the folder to enter to
 */
function setPath(path) {
    pathStack = [];
    enterDirectory(path);
}

/**
 * Enters the previous directory (if there's one)
 */
function enterParentDirectory() {
    if (pathStack.length > 0) pathStack.splice(pathStack.length - 1, 1);
    else return false;
    return true;
}

/**
 * Get the current folder ID of the pathStack
 */
function getCurrentFolder() {
    if (pathStack.length > 0) return pathStack[pathStack.length - 1];
    else return undefined;
}

/**
 * Remove the last x entries of the pathStack
 * @param {Integer} removeCount Number of entries to remove from the pathStack
 */
function removePathStackEntries(removeCount) {
    for (let i = 0; i < removeCount; i++) {
        if (!enterParentDirectory()) break;
    }
}

/**
 * Login the to my cloud website
 * @param {String} username The username
 * @param {String} password The password
 */
function authenticate(username, password) {
    creds.user = username;
    creds.pass = password;
    return new Promise(async (resolve) => {
        const loginResult = await login(username, password);
        resolve(loginResult);
    });
}

/**
 * List the files in the current folder
 */
async function listFiles() {
    try {
        return await retryLimited(10, 'list files', _listFiles, []);
    } catch (error) {
        throw error;
    }
}

/**
 * Retryable function for listing files
 */
async function _listFiles() {
    const currentPath = pathStack.length > 0 ? pathStack[pathStack.length - 1] : 'root';
    // List files
    const result = await ls(tokens.auth, currentPath);

    if (result.success) {
        return { success: true, data: result.result };
    } else {
        if (result.error) {
            return { success: false };
        } else {
            // Session timed out, login and run the function again
            const self = await authRetry(_listFiles, []);
            const result = await self;
            return result;
        }
    }
}

/**
 * Create a new directory in the current directory
 * @param {String} dirName The name of the new directory
 */
async function createDirectory(dirName) {
    try {
        return await retryLimited(10, 'create new directory', _createDirectory, [dirName]);
    } catch (error) {
        throw error;
    }
}

/**
 * Retryable function for creating new directories
 * @param {String} dirName The name of the directory to create
 */
function _createDirectory(dirName) {
    return new Promise(async (resolve) => {
        // Get the current path
        const currentPath = pathStack.length > 0 ? pathStack[pathStack.length - 1] : 'root';

        // Create the directory
        const result = await mkdir(tokens.auth, currentPath, dirName);
        if (result.success) {
            resolve({ success: true, data: result.result });
        } else {
            if (result.error) {
                resolve({ success: false });
            } else {
                // Session timed out, login and run the function again
                const self = await authRetry(_createDirectory, [dirName]);
                const result = await self;
                resolve(result);
            }
        }
    });
}

/**
 * Deletes a file/folder in the current directory
 * @param {String} fileID The ID of the file/folder to remove
 */
async function removeFile(fileID) {
    try {
        return await retryLimited(10, 'remove file', _removeFile, [fileID]);
    } catch (error) {
        throw error;
    }
}

/**
 * Retryable function for removing entries
 * @param {String} fileID The ID of the entry to remove
 */
async function _removeFile(fileID) {
    // Remove the file/folder
    const result = await rm(tokens.auth, fileID);
    if (result.success) {
        return { success: true, data: result.result };
    } else {
        if (result.error) {
            return { success: false };
        } else {
            // Session timed out, login and run the function again
            const self = await authRetry(_removeFile, [fileID]);
            const result = await self;
            return result;
        }
    }
}

/**
 * Uploads a local file to the current folder on the cloud
 * @param {String} filePath The local path of the file to upload
 * @param {Function} progressCallback A function to send the percentage to
 */
async function uploadFile(filePath, progressCallback) {
    try {
        return await retryLimited(10, 'upload file', _uploadFile, [filePath, progressCallback]);
    } catch (error) {
        throw error;
    }
}

/**
 * Retryable function for uploading a file
 * @param {String} filePath The path of the file on the local system
 * @param {Function} progressCallback The function to be called with the progress of the upload
 */
function _uploadFile(filePath, progressCallback) {
    return new Promise((resolve) => {
        const currentPath = pathStack.length > 0 ? pathStack[pathStack.length - 1] : 'root';
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            resolve({ success: false });
            return;
        }
        // Get the size of the file, required to calculate percentage of the progress
        const totalSize = fs.statSync(filePath).size;
        // Upload the file
        upl(tokens.auth, currentPath, filePath, (bytesWritten) => {
            if (totalSize == 0) {
                progressCallback(100);
                return;
            }
            const percentage = bytesWritten * 100 / totalSize;
            // Send the progress to the caller
            progressCallback(percentage);
        }, async (finalResult) => {
            // Upload finished or error or session is invalid
            if (finalResult.success) {
                resolve({ success: true, data: finalResult.result });
            } else {
                if (finalResult.error) {
                    resolve({ success: false });
                } else {
                    // Session timed out, login and run the function again
                    const self = await authRetry(uploadFile, [filePath, progressCallback]);
                    const result = await self;
                    resolve(result);
                }
            }
        });
    });
}

/**
 * Download a file from the wdc
 * @param {String} fileID The ID of the file to download
 * @param {String} localFilePath The path to save the remote file to on the local system
 * @param {Function} progressCallback Function to call with the percentage progress
 */
async function downloadFile(fileID, localFilePath, progressCallback) {
    try {
        return await retryLimited(10, 'download file', _downloadFile, [fileID, localFilePath, progressCallback]);
    } catch (error) {
        throw error;
    }
}

/**
 * Retryable function for downloading files from the wdc
 * @param {String} fileID The ID of the file to download
 * @param {String} localFilePath The path to save the remote file to on the local system
 * @param {Function} progressCallback Function to call with the percentage progress
 */
async function _downloadFile(fileID, localFilePath, progressCallback) {
    const result = await dwl(tokens.auth, fileID, localFilePath, (data) => {
        if (data.total == 0) progressCallback(100); // Can't divide by 0 if total size is 0
        else {
            progressCallback(data.offset * 100 / data.total);
        }
    });
    if (result.success) {
        return { success: true, data: result.result };
    } else {
        if (result.error) {
            return { success: false };
        } else {
            // Session timed out, login and run the function again
            const self = await authRetry(_downloadFile, [fileID, localFilePath, progressCallback]);
            const result = await self;
            return result;
        }
    }
}

/**
 * Retry an abstracted function a certain if failed
 * @param {Integer} tryLimit The number of maxiumum executions of the specified function
 * @param {String} actionName The friendly display name of the action
 * @param {Function} abstractedFunction The abstracted function to call to exectue the action
 * @param {Array} afArgs An array of arguments to pass to the abstracted function
 */
async function retryLimited(tryLimit, actionName, abstractedFunction, afArgs) {
    let tryCounter = 0;
    const callAbstracted = async () => {
        if (tryCounter > tryLimit) {
            return { success: false };
        }
        tryCounter++;
        if (attempt > 1) log.debug(`Attempt ${tryCounter} to ${actionName}`);
        const result = await abstractedFunction(...afArgs);
        if (!result.success) return await callAbstracted();
        else return { success: true, data: result.data };
    };

    const recursiveResult = await callAbstracted();
    if (recursiveResult.success) return recursiveResult.data;
    else throw new Error(`tried to ${actionName} 10 times and failed`);
}

/**
 * Re-authenticate the client and try the current action again
 * @param {Function} func The function to call after re-authenticating
 * @param {Array} args An array of arguments to pass to the function
 */
async function authRetry(func, args) {
    log.warn('Re-authentication initiated');
    await authenticate(creds.user, creds.pass); // Authenticate with cached credentials
    return func(...args); // Re-call the parent function
}

/**
 * Enable the logging of API level messages
 */
function enableAPIMessages() {
    log.enable();
}

/**
 * Disable the logging of API level messages
 */
function disableAPIMessages() {
    log.disable();
}

/**
 * Set the host to send the requests to
 * @param {String} host The host to send the requests to
 */
function setWdHost(host) {
    wdHost = host;
}
module.exports = {
    authenticate,
    enterDirectory,
    enterParentDirectory,
    getCurrentFolder,
    removePathStackEntries,
    listFiles,
    createDirectory,
    removeFile,
    uploadFile,
    downloadFile,
    enableAPIMessages,
    disableAPIMessages,
    setWdHost,
};