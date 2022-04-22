import { expect } from 'chai';
import { MessageStoreLevel } from '../../src/store/message-store';

describe('MessageStoreLevel Tests', () => {
  describe('_buildIndexQueryTerms', () => {
    it('returns an array of terms based on the query object provided', () => {
      const query = {
        method   : 'CollectionsQuery',
        schema   : 'https://schema.org/MusicPlaylist',
        objectId : 'abcd123'
      };

      const expected = ['method:CollectionsQuery', 'schema:https://schema.org/MusicPlaylist', 'objectId:abcd123'];
      const terms = MessageStoreLevel._buildIndexQueryTerms(query);

      expect(terms).to.eql(expected);
    });

    it('flattens nested objects', () => {
      const query = {
        requester : 'AlBorland',
        ability   : {
          method : 'CollectionsQuery',
          schema : 'https://schema.org/MusicPlaylist',
          doo    : {
            bingo: 'bongo'
          }
        }
      };

      const expected = [
        'requester:AlBorland',
        'ability.method:CollectionsQuery',
        'ability.schema:https://schema.org/MusicPlaylist',
        'ability.doo.bingo:bongo'
      ];

      const terms = MessageStoreLevel._buildIndexQueryTerms(query);

      expect(terms).to.eql(expected);
    });
  });
});