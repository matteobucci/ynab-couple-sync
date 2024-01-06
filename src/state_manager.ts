import { promises as fs } from 'fs';
import path from 'path';


export class StateManager<T> {

    filePath: string;
    dirPath: string;
    
    constructor(private fileName: string, private folder: string = "users") {
        this.dirPath = path.join(__dirname, 'state', this.folder);
        this.filePath = path.join(__dirname, 'state', this.folder, this.fileName);
        // Create a dir if it does not exist
        fs.mkdir(this.dirPath, { recursive: true });
    }

    async getSavedState(): Promise<T|null> {

        try {
            const data = await fs.readFile(this.filePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error("File state does not exist", this.filePath, error);
            return null;
        }
    }

    async setSavedState(state: T): Promise<void> {
        try {
            // First, if path or file does not exist, create it
            // Then, write the file
            const data = JSON.stringify(state, null, 2);
            await fs.writeFile(this.filePath, data, 'utf8');
            console.log(`Saved state to ${this.filePath}`);
        } catch (error) {
            console.error("Error writing state file:", this.filePath, error);
        }
    }
}
