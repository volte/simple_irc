import { RxSocket } from "./RxSocket";
import { RxIRCClient, RxIRCChannel } from "./RxIRCClient";
import * as net from "net";

const client = new RxIRCClient({
  hostname: "irc.synirc.net",
  port: 6667,
  username: "VolteTest",
  nick: "VolteTest",
  realName: "foo"
});

client.messages$.subscribe(x => console.log(x));

// Welcome message
client.commandStream("001").subscribe(() => {
  let channel = new RxIRCChannel(client, "#VolteTest");
  channel.join();
  channel.commandStream("PRIVMSG").subscribe((message) => {
    if (message.params[1] == "@date") {
      channel.sendPrivMsg(`Current date is: ${new Date().toISOString()}`)
    }
  });
});

client.connect();