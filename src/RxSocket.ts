import * as Rx from "rxjs";
import * as net from "net";
import {filter, flatMap, scan} from "rxjs/operators";

/**
 * Rx wrapper around net.Socket
 */
export class RxSocket {
  readonly socket: net.Socket;

  // Write to the socket by called next() on the write$ observer
  readonly write$: Rx.Observer<Buffer | string | Uint8Array>;

  // Received data is emitted on the data$ observable
  readonly data$: Rx.Observable<Buffer | string>;

  // This observable emits true when the connection is ready.
  readonly connected$: Rx.Observable<boolean>;

  // This is a convenience observable that returns only complete lines (terminated with
  // a new line), buffering incomplete ones.
  get lines$(): Rx.Observable<string> {
    interface LineBuffer {
      complete: string[];
      incomplete: string
    }

    return this.data$.pipe(
      // This accumulator keeps track of complete and incomplete lines coming in
      scan((buffer: LineBuffer, data: Buffer | string) => {
        const incomplete = buffer.incomplete + data.toString();
        const lines = incomplete.match(/[^\n]+(?:\r?\n|$)/g) || [];

        if (!lines || lines.length === 0) {
          return { complete: [], incomplete: "" }
        }

        function trimTerminator(str: string): string {
          return str.replace(/\r?\n$/g, '');
        }

        // Check if the last line is complete
        let lastLineComplete = lines[lines.length - 1].endsWith("\n");
        if (lastLineComplete) {
          return {
            complete: lines.map(trimTerminator),
            incomplete: ""
          };
        }
        return {
          complete: lines.slice(0, lines.length - 1).map(trimTerminator),
          incomplete: lines[lines.length - 1]
        };
      }, { complete: [], incomplete: "" }),

      // The 'complete' buffer stores the lines that are ready to be emitted
      flatMap((buffer: LineBuffer) => Rx.from(buffer.complete))
    );
  }

  constructor(options?: net.SocketConstructorOpts) {
    let socket = new net.Socket(options);
    this.socket = socket;

    // The data observable listens to socket events.
    this.data$ = new Rx.Observable((subscriber) => {
      // Data on the socket goes directly to the subscriber
      function onData(data: Buffer | string) {
        subscriber.next(data);
      }
      socket.on("data", onData);

      // The receiver completes when the socket closes
      socket.once("close", (hadError) => {
        if (hadError) {
          subscriber.error(new Error("Transmission error"));
        } else {
          subscriber.complete();
        }
      });

      // When the server wants to end the connection, we respond in kind
      socket.once("end", () => { socket.end() });

      // To clean up, we unhook the data subscriber
      return () => {
        socket.removeListener("data", onData);
      };
    });

    // The sender observer writes to the socket.
    this.write$ = {
      error: (err) => {
        this.socket.destroy(err);
      },
      complete: () => {
        this.socket.end();
      },
      next: (data: Buffer | string | Uint8Array) => {
        console.log("sending: ", data.toString());
        this.socket.write(data);
      }
    };

    // The connection status is essentially a reactive variable, so we back it
    // with a behavior subject and set its value in the connect event.
    let connectedSubject = new Rx.BehaviorSubject<boolean>(false);
    this.connected$ = connectedSubject.asObservable();

    this.socket.once("connect", () => { connectedSubject.next(true) });
  }

  connect(options: net.SocketConnectOpts): RxSocket {
    this.socket.connect(options);
    return this;
  }

  end(): RxSocket {
    this.socket.end();
    return this;
  }

  destroy(error?: Error): RxSocket {
    this.socket.destroy(error);
    return this;
  }
}

