export interface IAuthGateway {
  login(email: string, password: string): Promise<string>;
}
