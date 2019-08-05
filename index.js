/**
 * Module to figure out the name of a local path
 */
const path = require('path');
/**
 * Module for filesystem integration
 */
const fs = require('fs');
/**
 * Module for input handling from the terminal
 */
const qoa = require('qoa');
/**
 * Module for communicating with the wdc device
 */
const bridge = require('./api');
/**
 * Wrapper module for signale package
 */
const log = require('./logging');
/**
 * Settings file
 */
const settings = require('./settings');
/**
 * Cache file listing in the current working directory
 */
let cwdCache = null;
/**
 * The local working directory
 * @type {string}
 */
let lwd = __dirname;

/**
 * Authenticate to the wdc
 * @param {String} user The username
 * @param {String} pass The password
 */
async function authenticate(user, pass) {
    const authResult = await bridge.authenticate(user, pass);
    if (!authResult) log.authFailed();
    else log.authSuccess();
}

/**
 * Get the id of the specified folder and enter it
 * @param {String} folderName The name of the folder to enter to
 */
async function seekAndEnter(folderName) {
    const lsResult = await bridge.listFiles();
    const targetDir = lsResult.find(item => item.name == folderName && item.isDir); // Find the folder in the list
    if (targetDir === undefined) { // Folder doesn't exist
        log.pathNotFound();
        return false;
    }
    else bridge.enterDirectory(targetDir.id);
    cwdCache = null;
    return true;
}

/**
 * Escape spaces and extend relative paths
 * @param {string} inputPath The path the user gave
 */
function formatPath(inputPath) {
    while (inputPath.indexOf('\\ ') > 0) {
        inputPath = inputPath.replace('\\ ', ' ');
    }
    return inputPath.startsWith('/') ? inputPath : path.join(lwd, inputPath);
}

/**
 * Upload a folder to the current working directory of the remote
 * @param {string} srcFolderPath The path of the folder to upload to the remote
 */
async function recursiveUploadFolders(srcFolderPath) {
    const uploadFolder = async (local, parent) => {
        // Enter the parent directory
        bridge.enterDirectory(parent);

        /**
         * Entires in the current local folder
         */
        const entries = fs.readdirSync(local);
        /**
         * List of folders in the current local folder
         */
        const folderList = [];
        /**
         * List of files in the current local folder
         */
        const fileList = [];
        /**
         * List of the created folder IDs on the remote
         */
        const idList = [];

        // Enumerate entries in current local directory
        entries.forEach(entry => {
            if (fs.statSync(local + '/' + entry).isDirectory()) folderList.push(entry);
            else fileList.push(entry);
        });

        // Create folders on remote
        for (const folder of folderList) {
            const directoryID = await bridge.createDirectory(folder);
            log.folderCreated(folder);
            idList.push(directoryID);
        }

        // Upload files to remote
        for (const file of fileList) {
            log.startFileUpload(file);
            try {
                await bridge.uploadFile(path.join(local, file), (progress) => log.setUploadProgress(file, progress));
                log.fileUploadDone();
            } catch (error) {
                log.fileUploadFail(error);
            }
        }

        // Check folders in current local directory for more entries
        for (let i = 0; i < folderList.length; i++) {
            // Upload child folder, will enter child folder as parent
            await uploadFolder(path.join(local, folderList[i]), idList[i]);
            // Restore the parent folder in the api stack
            bridge.enterParentDirectory();
        }
    };

    // Save current folder, to restore after upload is done
    const currentFolderID = bridge.getCurrentFolder();
    // Create main directory on remote
    const mainFolderID = await bridge.createDirectory(path.basename(srcFolderPath));
    // Begin uploading content
    await uploadFolder(srcFolderPath, mainFolderID);
    // Restore original working directory
    bridge.enterDirectory(currentFolderID);
}

/**
 * Download an entire folder from the remote device to the local system
 * @param {string} srcFolderID The ID of the remote forlder to download
 * @param {string} basepath The path to download the folder to, including the name of the folder
 */
async function recursiveDownloadFolders(srcFolderID, basepath) {
    const downloadFolder = async (remoteFolderID, localPath) => {
        // Enter the current directory
        bridge.enterDirectory(remoteFolderID);

        /**
         * Entires in the current remote folder
         */
        const entries = await bridge.listFiles();
        /**
         * List of folders in the current remote folder
         */
        const folderList = entries.filter(entry => entry.isDir);
        /**
         * List of files in the current remote folder
         */
        const fileList = entries.filter(entry => !entry.isDir);

        // Create folders on the local system
        for (const folder of folderList) {
            const localPathNewFolder = path.join(localPath, folder.name);
            fs.mkdirSync(localPathNewFolder);
        }

        // Download files from remote
        for (const file of fileList) {
            log.startFileDownload(file.name);
            const filePath = path.join(localPath, file.name);
            try {
                await bridge.downloadFile(file.id, filePath, (progress) => log.setDownloadProgress(file.name, progress));
                log.fileDownloadDone(filePath);
            } catch (error) {
                log.fileDownloadFail(error);
            }
        }

        // Download subfolders from the remote
        for (const folder of folderList) {
            // Download the subfolder from the remote
            await downloadFolder(folder.id, path.join(localPath, folder.name));
        }
    };

    // Get the ID of the current working directory
    const currentFolderID = bridge.getCurrentFolder();
    bridge.enterDirectory(srcFolderID);
    // Create main directory on remote
    fs.mkdirSync(basepath);
    // Begin uploading content
    await downloadFolder(srcFolderID, basepath);
    // Restore the original working directory
    bridge.enterDirectory(currentFolderID);
}

/**
 * Simple command shell for user interaction
 */
async function handleCommands() {
    while (true) {
        const result = await qoa.input({type: 'input', query: '> ', handle: 'command'});
        /**
         * @type {string}
         */
        const command = result.command;
        if (command === 'exit') break;
        else if (command === 'auth') {
            // Get the username and the password
            const credentials = await qoa.prompt([
                {type: 'input', query: 'Username: ', handle: 'username'},
                {type: 'hidden', query: 'Password: ', handle: 'password'},
            ]);
            
            await authenticate(credentials.username, credentials.password);
        } else if (command === 'auth -a') {
            await authenticate(settings.user, settings.pass);
        } else if (command === 'ls') {
            const lsResult = await bridge.listFiles();
            cwdCache = lsResult;
            lsResult.forEach(entry => log.logEntry(entry));
        } else if (command === 'clear') console.clear();
        else if (command.startsWith('cd ')) {
            const path = command.substring(3);
            if (path === '/') bridge.enterDirectory('root'); // Root path
            else if (path.indexOf('/') < 0) { // Only one folder, relative path
                if (cwdCache !== null) {
                    const targetDir = cwdCache.find(item => item.name == path && item.isDir);
                    if (targetDir === undefined) log.pathNotFound();
                    else bridge.enterDirectory(targetDir.id);
                    cwdCache = null;
                } else {
                    await seekAndEnter(path);
                }
            } else { // Multiple folders relative path or absolute path
                const pathParts = path.split('/');
                let iterator = 0;
                for (const currentFolder of pathParts) {
                    if (currentFolder === '') { // Root folder or trailing slash (ignoring trailing slash)
                        if (iterator === 0) bridge.enterDirectory('root'); // Enter the root folder
                    } else if (currentFolder === '..') { // Parent directory
                        bridge.enterParentDirectory();
                        cwdCache = null;
                    } else { // Actual folder to enter
                        const result = await seekAndEnter(currentFolder); // Get the ID of the folder and enter it
                        if (!result) { // If folder doesn't exists go back to the original folder
                            if (iterator > 0) bridge.removePathStackEntries(iterator);
                        }
                    }

                    iterator++;
                }
            }
        } else if (command.startsWith('mkdir ')) {
            const folderName = command.substring(6);
            if (folderName.indexOf('/') > -1) {
                log.onlyRelativePath();
            } else {
                await bridge.createDirectory(folderName);
            }
        } else if (command.startsWith('rm ')) {
            const entryName = command.substring(3);
            if (entryName.indexOf('/') > -1) {
                log.onlyRelativePath();
            } else {
                if (cwdCache === null) cwdCache = await bridge.listFiles();
                
                const target = cwdCache.find(item => item.name == entryName);
                if (target !== undefined) await bridge.removeFile(target.id);
                else log.pathNotFound(entryName);
            }
        } else if (command.startsWith('upload ')) {
            const localPath = command.substring(7);
            const fullLocalPath = formatPath(localPath);
            const fileName = path.basename(fullLocalPath);
            const entryIsDirectory = fs.statSync(fullLocalPath).isDirectory();
            if (entryIsDirectory) {
                await recursiveUploadFolders(fullLocalPath);
            } else {
                log.startFileUpload(fileName);
                try {
                    await bridge.uploadFile(fullLocalPath, (progress) => log.setUploadProgress(fileName, progress.toFixed(2)));
                    log.fileUploadDone();
                } catch (error) {
                    log.fileUploadFail(error);
                }
            }
        } else if (command.startsWith('download ')) {
            const entryName = command.substring(9);
            if (entryName.indexOf('/') > -1) {
                log.onlyRelativePath();
            } else {
                if (cwdCache === null) cwdCache = await bridge.listFiles();
                
                const target = cwdCache.find(item => item.name == entryName);
                if (target !== undefined) {
                    const localPath = path.join(lwd, target.name);
                    if (target.isDir) {
                        await recursiveDownloadFolders(target.id, localPath);
                    } else {
                        try {
                            log.startFileDownload(target.name);
                            await bridge.downloadFile(target.id, localPath, (progress) => log.setDownloadProgress(target.name, progress.toFixed(2)));
                            log.fileDownloadDone(localPath);
                        } catch (error) {
                            log.fileDownloadFail(error);
                        }
                    }
                }
                else log.pathNotFound(entryName);
            }
        } else if (command === 'help') {
            console.log('help - display this menu');
            console.log('exit - exit from the wdc shell');
            console.log('clear - clear the screen');
            console.log('ls - Get the list of entries in the current working directory');
            console.log('auth - authenticate to the wdc server');
            console.log('auth -a - authenticate to the wdc server with the credentials stored in settings.json');
            console.log('mkdir [folder name] - create a new folder in the current working directory');
            console.log('rm [entry name] - remove an entry from the current working directory');
            console.log('cd [path] - change the current working directory');
            console.log('upload [local file path] - upload a file to the current working directory');
            console.log('download [remote file name] - download a remote file from the current working directory');
            console.log('l pwd - print the current working directory on the local system');
            console.log('l cd [local path] - change the current working directory on the local system');
            console.log('l ls [path] - list files in the given folder/current working directory if not given');
        } else if (command.startsWith('l ')) {
            const localCommand = command.substring(2);
            if (localCommand === 'pwd') {
                console.log(`The current local working directory is: ${lwd}`);
            } else if (localCommand.startsWith('cd ')) {
                let givenPath = localCommand.substring(3);
                const fullPath = formatPath(givenPath);
                if (fs.existsSync(fullPath)) {
                    lwd = fullPath;
                } else {
                    log.pathNotFound(fullPath);
                }
            } else if (localCommand.startsWith('ls')) {
                let fullPath = lwd;
                if (localCommand.length > 2) {
                    let givenPath = localCommand.substring(3);
                    fullPath = formatPath(givenPath);
                }

                if (fs.existsSync(fullPath)) {
                    const entries = fs.readdirSync(fullPath);
                    entries.sort((left, right) => {
                        // Ignore case, and dots
                        const a = left.toLowerCase().replace('.', '');
                        const b = right.toLowerCase().replace('.', '');
                        if (a > b) return 1;
                        else if (a < b) return -1;
                        else return 0;
                    });
                    const entryList = entries.map(entry => {
                        const entryPath = path.join(fullPath, entry);
                        const isDir = fs.statSync(entryPath).isDirectory();
                        return {name: entry, isDir};
                    });
                    entryList.forEach(entry => log.logEntry(entry));
                } else {
                    log.pathNotFound(fullPath);
                }
            }
        }
    }
}

bridge.setWdHost(settings.wdHost);
handleCommands();