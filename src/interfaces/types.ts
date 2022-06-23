import type { JsonMessage } from '../messages/types';
import type { MessageStore } from '../store/message-store';

import { DIDResolver } from '../did/did-resolver';

export type InterfaceMethod = (message: JsonMessage, messageStore: MessageStore, didResolver: DIDResolver) => Promise<void>;

export interface Interface {
  methods: InterfaceMethod[];
  schemas: { [key:string]: object };
}