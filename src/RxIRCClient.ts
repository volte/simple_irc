import { RxSocket } from "./RxSocket";
import * as Rx from "rxjs";
import {filter, map} from "rxjs/operators";
import {flatMap} from "rxjs/internal/operators";

/** Options for creating an IRC client. */
export namespace RxIRCClient {
  export interface Options {
    hostname: string
    username: string
    port: number
    nick: string
    realName: string
  }
}

/** Simple IRC message interface. */
export interface IRCMessage {
  prefix?: string;
  command: string;
  params: string[];
}

/** Reactive IRC client. */
export class RxIRCClient {
  private readonly subscription = new Rx.Subscription();

  readonly socket: RxSocket;
  readonly options: RxIRCClient.Options;

  readonly messages$: Rx.Observable<IRCMessage>;
  readonly send$: Rx.Observer<IRCMessage>;

  constructor(options: RxIRCClient.Options) {
    this.socket = new RxSocket();
    this.options = options;

    // Parse IRC messages as they come in
    this.messages$ = this.socket.lines$.pipe(
      flatMap(line => {
        const message = parseIRCMessage(line);
        if (!message) {
          return Rx.EMPTY;
        }
        return Rx.from([message]);
      })
    );

    // Send IRC messages
    this.send$ = {
      complete: () => { this.socket.write$.next("QUIT :Leaving\r\n") },
      error: () => { this.socket.write$.next("QUIT :Error\r\n") },
      next: (message) => {
        const paramCount = message.params.length;
        const data = `${message.command} ${message.params.slice(0, paramCount - 1).join(" ")} ` +
                     `:${message.params.slice(paramCount - 1).join(" ")}\r\n`;
        this.socket.write$.next(data);
      }
    };

    // Set up IRC protocol handling
    this.handleIRCProtocol();
  }

  private sendUserAndNick() {
    this.send({
      command: "USER",
      params: [this.options.username, ".", ".", this.options.realName]
    });
    this.send({
      command: "NICK",
      params: [this.options.nick]
    });
  }

  private handleIRCProtocol() {
    this.subscription.add(
      this.socket.connected$.pipe(filter(x => x)).subscribe({
        next: () => {
          this.sendUserAndNick();
        }
      })
    );

    this.subscription.add(
      this.messages$.subscribe({
        next: (message) => {
          switch (message.command) {
            case "PING":
              this.send({
                command: "PONG",
                params: message.params
              });
              break;
            default: break;
          }
        }
      })
    );
  }

  /** Return a stream of the specified command. */
  commandStream(command: string): Rx.Observable<IRCMessage> {
    return this.messages$.pipe(filter(message => message.command === command));
  }

  connect() {
    this.socket.connect({
      host: this.options.hostname,
      port: this.options.port
    });
  }

  send(message: IRCMessage) {
    this.send$.next(message);
  }
}

/** Reactive interface to a single channel. */
export class RxIRCChannel {
  readonly client: RxIRCClient;
  readonly channel: string;

  readonly messages$: Rx.Observable<IRCMessage>;

  constructor(client: RxIRCClient, channel: string) {
    this.client = client;
    this.channel = channel;

    this.messages$ = this.client.messages$.pipe(
      filter(message => message.params.length > 0 && message.params[0].toLowerCase() == this.channel.toLowerCase())
    );
  }

  join() {
    this.client.send({ command: "JOIN", params: [this.channel] });
  }

  sendPrivMsg(message: string) {
    this.client.send({ command: "PRIVMSG", params: [this.channel, message] });
  }
}

/** Turn a raw line of text into an IRC message. */
export function parseIRCMessage(line: string): IRCMessage | undefined {
  let index = 0;

  function peekNext(): string {
    if (index >= line.length) {
      return "";
    }
    return line[index];
  }

  function scanNext(): string {
    const c = peekNext();
    if (index < line.length) { index++ }
    return c;
  }

  function skip(c: string): boolean {
    if (peekNext() === c) {
      scanNext();
      return true;
    }
    return false;
  }

  function skipSpaces(): boolean {
    return scanWhile(c => c === " ").length > 0;
  }

  function scanWhile(pred: (c: string) => boolean): string {
    let result = "";
    while (true) {
      const char = peekNext();
      if (char === "" || !pred(char)) {
        return result;
      }
      scanNext();
      result += char;
    }
  }

  function isEOF(): boolean {
    return index >= line.length;
  }

  let message: IRCMessage = {
    prefix: undefined,
    command: "",
    params: []
  };

  // Parse prefix
  if (skip(":")) {
    message.prefix = scanWhile(c => c !== " ");
    if (!skipSpaces()) {
      return message;
    }
  }

  // Parse command name or number
  message.command = scanWhile(c => c !== " ");

  if (!skipSpaces()) {
    return message;
  }

  // Parse parameters
  while (true) {
    // Check for trailing parameter
    if (skip(":")) {
      message.params.push(scanWhile(() => true));
      return message;
    }
    const param = scanWhile(c => c !== " ");
    message.params.push(param);
    skipSpaces();
    if (isEOF()) {
      return message;
    }
  }
}
