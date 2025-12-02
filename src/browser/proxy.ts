export class ProxyFormatException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProxyFormatException';
  }
}

export class Proxy {
  server: string;
  username?: string;
  password?: string;

  private static proxyReg = /^(?<schema>\w+):\/\/(?:(?<user>[^:]+):(?<password>[^@]+)@)?(?<ip>.*?)(?::(?<port>\d+))?$/;

  constructor(server: string, username?: string, password?: string) {
    this.server = server;
    this.username = username;
    this.password = password;
  }

  get url(): string {
    if (this.username && this.password) {
      const [schema, rest] = this.server.split('://');
      return `${schema}://${this.username}:${this.password}@${rest}`;
    }
    return this.server;
  }

  toString(): string {
    return `<BrowserProxy ${this.server}>`;
  }

  static fromUrl(host: string): Proxy {
    const match = host.match(Proxy.proxyReg);
    if (!match || !match.groups) {
      throw new ProxyFormatException(`Invalid proxy: ${host}`);
    }

    const { schema, user, password, ip, port } = match.groups;
    
    // Construct the server URL part
    // The Python implementation reconstructs it as schema://ip:port
    const server = `${schema}://${ip}${port ? ':' + port : ''}`;

    return new Proxy(server, user, password);
  }

  toPlaywright(): { server: string; username?: string; password?: string } {
    if (!this.username) {
      return { server: this.server };
    }
    return {
      server: this.server,
      username: this.username,
      password: this.password,
    };
  }
}

