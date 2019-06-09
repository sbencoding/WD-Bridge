/**
 * Module for printing beautiful text to the terminal
 */
const signale = require('signale');
// Always show the timestamp when using signale
signale.config({displayTimestamp: true});
/**
 * Logger for uploading files
 */
const uploadProgress = new signale.Signale({interactive: true, scope: 'File Upload'});
/**
 * Logger for downloading files
 */
const downloadProgress = new signale.Signale({interactive: true, scope: 'File Download'});
/**
 * Logger for API messages
 */
const apiLogger = new signale.Signale({scope: 'API'});

/**
 * Get the API logger
 */
function getAPILogger() {
    return apiLogger;
}

/**
 * Generate error message for missing entry
 * @param {String} path The path of the given entry
 */
function pathNotFound(path) {
    signale.error('Failed to located the following path: ' + path);
}

/**
 * Print an entry to the terminal
 * @param {Object} entry The entry result from the listFiles function
 */
function logEntry(entry) {
    if (entry.isDir) console.log(`\x1b[36m${entry.name}\x1b[0m/`);
    else console.log(entry.name);
}

/**
 * Print successful authentication to the terminal
 */
function authSuccess() {
    signale.success('Authentication to wdc successful');
}

/**
 * Print failed authentication to the terminal
 */
function authFailed() {
    signale.error('Failed to authenticate to the wdc with given credentials');
}

/**
 * Upadte the progress of the file upload
 * @param {String} fileName The name of the currently uploading file
 * @param {Number} progress The progress of the upload
 */
function setUploadProgress(fileName, progress) {
    uploadProgress.await('Uploading %s is %d%% done', fileName, progress);
}

/**
 * Print starting upload notification
 * @param {String} fileName The name of the file
 */
function startFileUpload(fileName) {
    uploadProgress.pending('Starting upload for %s', fileName);
}

/**
 * Print a file upload done notification
 */
function fileUploadDone() {
    signale.complete('File upload done');
}

/**
 * Print a file upload failed notification along with the thrown error
 * @param {Error} internalError The error thrown by the API
 */
function fileUploadFail(internalError) {
    signale.fatal('Failed to upload file');
    signale.error(internalError);
}

/**
 * Upadte the progress of the file download
 * @param {String} fileName The name of the currently downloading file
 * @param {Number} progress The progress of the download
 */
function setDownloadProgress(fileName, progress) {
    downloadProgress.await('Downloading %s is %d%% done', fileName, progress);
}

/**
 * Print starting download notification
 * @param {String} fileName The name of the file
 */
function startFileDownload(fileName) {
    downloadProgress.pending('Starting download for %s', fileName);
}

/**
 * Print a file download done notification
 */
function fileDownloadDone(filePath) {
    signale.complete('File download done, file saved to: ' + filePath);
}

/**
 * Print a file download failed notification along with the thrown error
 * @param {Error} internalError The error thrown by the API
 */
function fileDownloadFail(internalError) {
    signale.fatal('Failed to download file');
    signale.error(internalError);
}

/**
 * Error when user specifies a non-relative/more than one level deep path
 */
function onlyRelativePath() {
    signale.error('Path must be relative (the specified path should not contain path separator characters)');
}

module.exports = {
    authSuccess,
    authFailed,
    fileDownloadDone,
    startFileDownload,
    setDownloadProgress,
    fileUploadDone,
    startFileUpload,
    setUploadProgress,
    logEntry,
    pathNotFound,
    onlyRelativePath,
    fileUploadFail,
    fileDownloadFail,
    getAPILogger
}