import { Transform } from 'stream' // Import Transform class from the stream module
import createPool from 'reuse-pool' // Import createPool function from the reuse-pool module
import toArrayBuffer from 'to-arraybuffer' // Import toArrayBuffer function from the to-arraybuffer module

// Create a pool of Worker instances using the decode-worker.js file as the worker script
const pool = createPool(function () {
    return new Worker(require.resolve('./decode-worker'), { 'all': true})
})

// Prepare the first worker by recycling it into the pool
pool.recycle(pool.get())

// Define a custom stream class that extends Transform
class DecoderStream extends Transform {
    constructor() {
        // Call the parent constructor with the object mode option
        super({ objectMode: true })

        // Get a worker instance from the pool
        this._worker = pool.get()

        // Add an event listener for the worker's "message" event
        this._worker.onmessage = msg => {
            // If the worker has an objectURL property, revoke it
            if (this._worker.objectURL) {
                window.URL.revokeObjectURL(this._worker.objectURL)
                this._worker.objectURL = null
            }
            // Handle the message from the worker
            this._onMessage(msg.data)
        }
    }

    // Method for handling messages from the worker
    _onMessage(data) {
        // If the action is "decoded", push a new object to the stream with the decoded audio data
        if (data.action === 'decoded') {
            this.push({
                target: data.target,
                pcm: new Float32Array(data.buffer),
                numberOfChannels: data.numberOfChannels,
                position: data.position
            })
        // If the action is "reset", call the final callback to end the stream
        } else if (data.action === 'reset') {
            this._finalCallback()
        // Otherwise, throw an error for an unexpected message
        } else {
            throw new Error('unexpected message:' + data)
        }
    }

    // Method for transforming incoming data chunks
    _transform(chunk, encoding, callback) {
        // If the chunk has a frame property, create a new ArrayBuffer and post a message to the worker with the encoded audio data
        if (chunk.frame) {
            const buffer = toArrayBuffer(chunk.frame)
            this._worker.postMessage({
                action: 'decode' + chunk.codec,
                buffer: buffer,
                target: chunk.target,
                position: chunk.position
            }, [buffer])
        // If the chunk doesn't have a frame property, post a message to the worker indicating no data
        } else {
            this._worker.postMessage({
                action: 'decode' + chunk.codec,
                buffer: null,
                target: chunk.target,
                position: chunk.position
            })
        }
        // Call the callback function to continue processing data
        callback()
    }

    // Method for ending the stream
    _final(callback) {
        // Send a message to the worker to reset its state
        this._worker.postMessage({ id: this._id++, action: 'reset' })
        // Define a final callback function that recycles the worker and calls the original callback
        this._finalCallback = () => {
            pool.recycle(this._worker)
            this._worker = null
            callback()
        }
    }
}

// Export the DecoderStream class as the default export of this module
export default DecoderStream
