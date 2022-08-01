import { CollectionsWrite } from './messages/collections-write';
import { handleCollectionsWrite } from './handlers/collections-write';

export const CollectionsInterface = {
  methodHandlers : { 'CollectionsWrite': handleCollectionsWrite },
  messages       : [ CollectionsWrite ]
};