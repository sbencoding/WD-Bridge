# WD Bridge
WD Bridge is a terminal application/API written in NodeJS, that uses the WD web sdk under the hood, to access WD cloud devices that don't appear as a NAS on the local network.  
This API was made because there was no way to programatically manage my WD My Cloud Home device, nor is it reachable from the terminal under a linux/unix device.  
The only way to access the device from a linux/unix environment was to use the web browser interface of the device.  

# Installation
Follow these instructions to install **WD Bridge**:  
 - Clone the repository
 - Cd into the cloned repository
 - execute `npm install` to install the required dependencies  

That's it, WD Bridge is now installed.  

## Settings
Here you may set your *username* and *password*, if you don't want to re-type it every time you enter the application.  
Additionally you have the ability to set the *wdHost* variable, which changes the host the requests are sent to.  
I didn't have the opportunity to test on multiple devices, so I don't know if the predefined host works just for me, or is globally working with every device.  
If you run into errors regarding this option, open a new issue and I'll be happy to fix it.  

# Usage
To launch the application you can type `node index` into your favorite terminal.  
From here you can use the `help` command to get the list of available commands inside the **WD Bridge**.  
Before anything you must use `auth` and enter your credentials to authenticate to the server.  
If you specified your credentials in the `settings.js` file, then you can use `auth -a` instead of `auth` to authenticate without having to type in your credentials.  
From this point there are a few basic commands that are available to you eg. `ls`, `cd`, `mkdir`, `rm`, `upload`, `download`.  
**Note:**  
Some commands like `mkdir`, `rm` and `download` only accept relative, 1 layer deep paths on the remote as arguments currently.  
`upload` automatically uploads to the current working directory on the remote, and `ls` only lists files in the current working directory.  
`cd` has *full* path support, that means:  
 - Supporting **.\./**
 - Supporting cd to **/**
 - Supporting **relative** and **absolute** paths, allowing **multiple layer deep paths** also  

# TODO
- [ ] Support *full* paths for every command (upload, download, ls, mkdir, rm)
- [ ] Support more WD features like (move, rename, get link, etc...)
- [ ] Documentation for `api.js` for use in other projects/automations