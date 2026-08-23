export namespace main {
	
	export class DownloadResult {
	    success: boolean;
	    savedPath?: string;
	    errorMessage?: string;
	
	    static createFrom(source: any = {}) {
	        return new DownloadResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.savedPath = source["savedPath"];
	        this.errorMessage = source["errorMessage"];
	    }
	}
	export class FeedbackPayload {
	    type: string;
	    message: string;
	    email?: string;
	
	    static createFrom(source: any = {}) {
	        return new FeedbackPayload(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.message = source["message"];
	        this.email = source["email"];
	    }
	}
	export class FeedbackResult {
	    success: boolean;
	    configured: boolean;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new FeedbackResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.configured = source["configured"];
	        this.message = source["message"];
	    }
	}
	export class HomeScreenState {
	    status: string;
	    errorMessage?: string;
	    roomId?: string;
	    participantUrl?: string;
	    qrSvg?: string;
	    expiresAt?: string;
	    closeDeadline?: string;
	    closingRemainingSeconds?: number;
	    pinRequired: boolean;
	    lanUrl?: string;
	    localUrl?: string;
	
	    static createFrom(source: any = {}) {
	        return new HomeScreenState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.errorMessage = source["errorMessage"];
	        this.roomId = source["roomId"];
	        this.participantUrl = source["participantUrl"];
	        this.qrSvg = source["qrSvg"];
	        this.expiresAt = source["expiresAt"];
	        this.closeDeadline = source["closeDeadline"];
	        this.closingRemainingSeconds = source["closingRemainingSeconds"];
	        this.pinRequired = source["pinRequired"];
	        this.lanUrl = source["lanUrl"];
	        this.localUrl = source["localUrl"];
	    }
	}
	export class ServerStatus {
	    status: string;
	    dataDir: string;
	    port: number;
	    localUrl: string;
	    lanUrl: string;
	    lanIp: string;
	    healthStatus: string;
	    readyStatus: string;
	    errorMessage?: string;
	
	    static createFrom(source: any = {}) {
	        return new ServerStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.dataDir = source["dataDir"];
	        this.port = source["port"];
	        this.localUrl = source["localUrl"];
	        this.lanUrl = source["lanUrl"];
	        this.lanIp = source["lanIp"];
	        this.healthStatus = source["healthStatus"];
	        this.readyStatus = source["readyStatus"];
	        this.errorMessage = source["errorMessage"];
	    }
	}
	export class UpdateInfo {
	    available: boolean;
	    currentVersion: string;
	    latestVersion: string;
	    assetUrl: string;
	    assetSize: number;
	    releaseNotes: string;
	    releaseUrl: string;
	    errorMessage?: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.available = source["available"];
	        this.currentVersion = source["currentVersion"];
	        this.latestVersion = source["latestVersion"];
	        this.assetUrl = source["assetUrl"];
	        this.assetSize = source["assetSize"];
	        this.releaseNotes = source["releaseNotes"];
	        this.releaseUrl = source["releaseUrl"];
	        this.errorMessage = source["errorMessage"];
	    }
	}
	export class UploadResult {
	    success: boolean;
	    fileId?: string;
	    filename?: string;
	    sizeBytes?: number;
	    contentType?: string;
	    errorMessage?: string;
	
	    static createFrom(source: any = {}) {
	        return new UploadResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.fileId = source["fileId"];
	        this.filename = source["filename"];
	        this.sizeBytes = source["sizeBytes"];
	        this.contentType = source["contentType"];
	        this.errorMessage = source["errorMessage"];
	    }
	}

}

