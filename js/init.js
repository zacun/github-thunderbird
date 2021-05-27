const Mails = {}; // Main object
const Threads = [];
let token;

function fillTemplate(templateId, data, elemId) {
    let template = $(`#${templateId}`).html();
    Mustache.parse(template);
    let rendered = Mustache.render(template, data);
    $(`#${elemId}`).html(rendered);
}

function fillMailsTemplate() {
    let firstMsg = [];
    let template = $(`#template-threadsList`).html();
    Mustache.parse(template);
    for (let thread of Threads) {
        Mails[thread.folderName][thread.threadId].mails.forEach(mail => {
            if (!firstMsg.includes(thread.threadId)) {
                let formatedDate = formateDate(Mails[thread.folderName][thread.threadId].data.date);
                let read = thread.read == true ? "&#10003;" : "Unread";
                let merge = thread.state[1];
                let rendered = Mustache.render(template, {...mail, folder: thread.folderName, threadid: thread.threadId, realdate: formatedDate, read: read, open: thread.state[0], merge: merge});
                $(`#threads-list tbody`).append(rendered);
                firstMsg.push(thread.threadId);
            }
        });
    }
    Search.init();
}

async function start() {
    let getToken = await browser.storage.local.get('token');
    if (getToken.token !== undefined) {
        token = getToken.token;
    } else {
        token = prompt("Please enter your generated Github token");
        while (token == null || token == '') {
            token = prompt("Please enter your valid generated Github token");
        }
        browser.storage.local.set({token: token});
    }
    let getThreadFolder = await browser.storage.local.get('threads');
    if (getThreadFolder.threads !== undefined) Threads = getThreadFolder.threads;
    let getStorage = await browser.storage.local.get('folders');
    if (getStorage.folders !== undefined) {
        for (let folder of getStorage.folders) {
            let messages = await getGitMessagesFromFolder(folder);
            for (let message of messages) {
                if (isThreaded(message)) {                    
                    let threadId = addToThreads(message);                    
                    let data = {
                        threadId: threadId,
                        eventId: Threads[threadId].eventId,
                        event: Threads[threadId].event,
                        repo: Threads[threadId].repo,
                    };
                    addToMails(threadId, data, message, folder.name);
                } else addToMails(-1, null, message, folder.name);
            }            
        }
        let cpt = 1;
        for (let thread of Threads) {
            getState(thread.owner, thread.repo, thread.event, thread.eventId).then(response => {
                thread.state = response;
                cpt++;
                if(cpt == Threads.length) {
                    setTimeout(() => {
                        $(".table tbody tr").remove();
                        fillMailsTemplate();
                    }, 65);                    
                }
            });
        }
        // Fills folders panel
        fillTemplate("template-listFolders", Object.keys(Mails), "folders ul");
        // Fills thread list (right upper panel);
        fillMailsTemplate();
    } else {
        $("#main").hide();
        $("#error").show();
    }
}

async function getState(owner, repo, event, eventId) {
    return new Promise((resolve, reject) => {
        let url;
        if (event == "pull") url = `https://api.github.com/repos/${owner}/${repo}/${event}s/${eventId}`;
        else url = `https://api.github.com/repos/${owner}/${repo}/${event}/${eventId}`;
        fetch(url, {
            method: "GET",
            headers: {
                Authorization: `token ${token}`, 
                Accept: "application/vnd.github.v3+json"
            },
        })
        .then(async (response) => {        
            let data = await response.json();
            let merged = data.merged === undefined ? false : data.merged;
            resolve([data.state, merged]);
        })
        .catch((error) => {
            throw new Error("Error:", error);
        });
    });    
}

async function getGitMessagesFromFolder(folder) {
    let messages = [];
    let res = [];
    let page = await browser.messages.list(folder);
    messages = page.messages;
    while (page.id) {
        page = await browser.messages.continueList(page.id);
        messages = messages.concat(page.messages);
    }
    for (let msg of messages) {
        let headers = await getHeaderFromMessageId(msg.id);
        let header = headers[0];
        if (header.hasOwnProperty("x-github-recipient-address")) {
            res.push(msg);
        }
    }
    return res;
}

async function getHeaderFromMessageId(id) {
    let tab = [];
    let messages = await browser.messages.getFull(id);
    let headers = messages.headers;
    tab.push(headers);
    return tab;
}

function getEventId(message) {   
    let header = message.headerMessageId;
    let index = header.indexOf("@github.com");
    header = header.split('/');
    if (header[2] == "issue") header[2] = "issues";
    if (header[2] == "pulls") header[2] = "pull";
    if (index > -1 && header[2] == "issues") {
        return [header[3], header[1], header[2], header[0]]; // number & repo & event
    } 
    if (index > -1 && header[2] == "pull") {
        let id = header[3];
        if (id.length > 1) {
            id = id.slice(0,1);
        }
        return [id, header[1], header[2], header[0]]; 
    }
    return null;
}

function isThreaded(message) {    
    let tabEvent = getEventId(message);
    return tabEvent != null ? true : false;
}

function formateDate(_date) {
    let date = new Date(_date);
    let day = date.getDate();
    let month = date.getMonth() + 1;
    let hours = date.getHours();
    let minutes = date.getMinutes();
    if (day >= 0 && day < 10) day = `0${day}`;
    if (month >= 0 && month < 10) month = `0${month}`;
    if (hours >= 0 && hours < 10) hours = `0${hours}`;
    if (minutes >= 0 && minutes < 10) minutes = `0${minutes}`;
    return `${day}/${month}/${date.getFullYear()} ${hours}:${minutes}`;
}

function addToThreads(message) {    
    let tabEvent = getEventId(message);
    if (tabEvent) {
        let eventId = tabEvent[0];
        let repo = tabEvent[1];
        let event = tabEvent[2];
        let owner = tabEvent[3];
        if (Threads.length > 0) {
            for (let t of Threads) {
                // Thread already exist
                if (t.repo == repo && t.event == event && t.eventId == eventId) {
                    if (message.date > t.realDate) {
                        t.realDate = message.date;
                    }
                    if (message.read == false) {
                        t.read = false;
                    }
                    return parseInt(t.threadId);
                }
            }
            // Thread does not exist
            Threads.push({
                repo: repo,
                event: event,
                eventId: eventId,
                folderName: message.folder.name,
                realDate: message.date,
                threadId: Threads.length,
                owner: owner,
                read: message.read,
                state: [],
            });
        } else {
            // No threads yet
            Threads[0] = {
                repo: repo,
                event: event,
                eventId: eventId,
                folderName: message.folder.name,
                realDate: message.date,
                threadId: 0,
                owner: owner,
                read: message.read,
                state: [],                
            };
        }
        return Threads.length-1;
    }
    return null;
}

function addToMails(threadId, data, message, folder) {
    if (threadId > -1) {
        if (Mails[folder] == undefined) Mails[folder] = {};
        for (let thread in Mails[folder]) {
            if (thread == threadId) {     
                if (message.date > Mails[folder][thread].data.date) {
                    Mails[folder][thread].data.date = message.date;
                }    
                Mails[folder][thread].mails.unshift({
                    id: message.id,
                    subject: message.subject,
                    author: message.author,
                    date: formateDate(message.date),
                    realDate: message.date,
                    folder: folder,
                    threadId: threadId,
                });
                return;
            }
        }
        Mails[folder][threadId] = {
            data: {
                ...data,
                date: message.date
            },
            mails: [{
                id: message.id,
                subject: message.subject,
                author: message.author,
                date: formateDate(message.date),
                realDate: message.date,
                folder: folder,
                threadId: threadId,
            }]
        };
    }   
}

start();