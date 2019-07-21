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
            const fileName = path.basename(localPath);
            log.startFileUpload(fileName);
            try {
                await bridge.uploadFile(localPath, (progress) => log.setUploadProgress(fileName, progress.toFixed(2)));
                log.fileUploadDone();
            } catch (error) {
                log.fileUploadFail(error);
            }
        } else if (command.startsWith('download ')) {
            const entryName = command.substring(9);
            if (entryName.indexOf('/') > -1) {
                log.onlyRelativePath();
            } else {
                if (cwdCache === null) cwdCache = await bridge.listFiles();
                
                const target = cwdCache.find(item => item.name == entryName && !item.isDir);
                if (target !== undefined) {
                    try {
                        log.startFileDownload(target.name);
                        await bridge.downloadFile(target.id, target.name, (progress) => log.setDownloadProgress(target.name, progress.toFixed(2)));
                        log.fileDownloadDone(target.name);
                    } catch (error) {
                        log.fileDownloadFail(error);
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
        } else if (command.startsWith('l ')) {
            const localCommand = command.substring(2);
            if (localCommand === 'pwd') {
                console.log(`The current local working directory is: ${lwd}`);
            } else if (localCommand.startsWith('cd ')) {
                let givenPath = localCommand.substring(3);
                while (givenPath.indexOf('\\ ') > 0) {
                    givenPath = givenPath.replace('\\ ', ' ');
                }
                const fullPath = givenPath.startsWith('/') ? givenPath : path.join(lwd, givenPath);
                if (fs.existsSync(fullPath)) {
                    lwd = fullPath;
                } else {
                    log.pathNotFound(fullPath);
                }
            } else if (localCommand.startsWith('ls')) {
                let fullPath = lwd;
                if (localCommand.length > 2) {
                    let givenPath = localCommand.substring(3);
                    while (givenPath.indexOf('\\ ') > 0) {
                        givenPath = givenPath.replace('\\ ', ' ');
                    }
                    fullPath = givenPath.startsWith('/') ? givenPath : path.join(lwd, givenPath);
                }

                if (fs.existsSync(fullPath)) {
                    const entries = fs.readdirSync(fullPath);
                    entries.sort((left, right) => {
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