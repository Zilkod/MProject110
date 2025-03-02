import { shutdownModules, startModules } from '../../src/modules';
import { FIVE_MINUTES, TEN_SECONDS } from '../utils/testQuery';
import { createRelation, internalDeleteElementById, internalLoadById } from '../../src/database/middleware';
import { SYSTEM_USER } from '../../src/utils/access';
import { RELATION_LOCATED_AT } from '../../src/schema/stixCoreRelationship';
import LocatedAtLocatedRule from '../../src/rules/located-at-located/LocatedAtLocatedRule';
import { addCity } from '../../src/domain/city';
import { RULE_PREFIX } from '../../src/schema/general';
import { FROM_START_STR, UNTIL_END_STR } from '../../src/utils/format';
import { activateRule, disableRule, getInferences, inferenceLookup } from '../utils/rule-utils';
import { RELATION_OBJECT_MARKING } from '../../src/schema/stixMetaRelationship';
import { wait } from '../../src/database/utils';

const RULE = RULE_PREFIX + LocatedAtLocatedRule.id;
const FRANCE = 'location--b8d0549f-de06-5ebd-a6e9-d31a581dba5d';
const HIETZING = 'location--ce920c5b-03ea-576d-ac1d-701d9d7a1bed';
const PARIS = 'location--521ef7f0-6bfa-58f9-adca-f5e1737524d5';
const WESTERN_EUROPE = 'location--a25f43bf-3e2d-55fe-ba09-c63a210f169d';
const EUROPE = 'location--2e9ef300-a1ab-5c9f-9297-dde66b71cae2';
const TLP_WHITE_ID = 'marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9';
const TLP_TEST_ID = 'marking-definition--78ca4366-f5b8-4764-83f7-34ce38198e27';

describe('Located at located rule', () => {
  it(
    'Should rule successfully activated',
    async () => {
      await startModules();
      const TLP_WHITE_INSTANCE = await internalLoadById(SYSTEM_USER, TLP_WHITE_ID);
      const TLP_TEST_INSTANCE = await internalLoadById(SYSTEM_USER, TLP_TEST_ID);
      // Check that no inferences exists
      const beforeActivationRelations = await getInferences(RELATION_LOCATED_AT);
      expect(beforeActivationRelations.length).toBe(0);
      // ---- base
      // HIETZING > located-in > FRANCE (Start: 2020-02-29T23:00:00.000Z, Stop: 2020-02-29T23:00:00.000Z, Confidence: 30)
      // FRANCE > located-in > WESTERN EUROPE (Start: none, Stop: none, Confidence: 0)
      // WESTERN EUROPE > located-in > EUROPE  (Start: none, Stop: none, Confidence: 0)
      // ---- inferences that will be created
      // HIETZING > located-in > WESTERN EUROPE (Start: 2020-02-29T23:00:00.000Z, Stop: 2020-02-29T23:00:00.000Z, Confidence: 15)
      // HIETZING > located-in > EUROPE (2 explanations) (Start: 2020-02-29T23:00:00.000Z, Stop: 2020-02-29T23:00:00.000Z)
      // FRANCE > located-in > EUROPE  (Start: none, Stop: none)
      // Activate rules
      await activateRule(LocatedAtLocatedRule.id);
      // Check database state
      const afterActivationRelations = await getInferences(RELATION_LOCATED_AT);
      // expect(afterActivationRelations.length).toBe(3);
      const hietzingToWesternEurope = await inferenceLookup(afterActivationRelations, HIETZING, WESTERN_EUROPE, RELATION_LOCATED_AT);
      expect(hietzingToWesternEurope).not.toBeNull();
      expect(hietzingToWesternEurope.confidence).toBe(23); // AVG 2 relations (30 + 0) = 15
      expect(hietzingToWesternEurope.start_time).toBe('2020-02-29T23:00:00.000Z');
      expect(hietzingToWesternEurope.stop_time).toBe('2020-02-29T23:00:00.000Z');
      const hietzingToEurope = await inferenceLookup(afterActivationRelations, HIETZING, EUROPE, RELATION_LOCATED_AT);
      expect(hietzingToEurope).not.toBeNull();
      // For confidence we have 2 explanations
      // HIETZING > located-in > WESTERN EUROPE [Confidence: 15] > located-in > EUROPE [Confidence: 0] = 8
      // HIETZING > located-in > FRANCE [Confidence: 30] > located-in > EUROPE  [Confidence: 0] = 15
      expect(hietzingToEurope.confidence).toBe(21); // AVG 2 relations (15 + 8) = 12
      expect(hietzingToEurope.start_time).toBe('2020-02-29T23:00:00.000Z');
      expect(hietzingToEurope.stop_time).toBe('2020-02-29T23:00:00.000Z');
      expect(hietzingToEurope[RULE].length).toBe(2);
      expect(hietzingToEurope.i_inference_weight).toBe(2);
      const franceToEurope = await inferenceLookup(afterActivationRelations, FRANCE, EUROPE, RELATION_LOCATED_AT);
      expect(franceToEurope).not.toBeNull();
      expect(franceToEurope.confidence).toBe(15);
      expect(franceToEurope.start_time).toBe(FROM_START_STR);
      expect(franceToEurope.stop_time).toBe(UNTIL_END_STR);
      // Create new element to trigger a live event
      // ---- base
      // PARIS > located-in > FRANCE (Start: 2020-01-20T20:30:00.000Z, Stop: 2020-02-29T10:00:00.000Z)
      // ---- inferences that will be created
      // PARIS > located-in > WESTERN EUROPE
      // PARIS > located-in > EUROPE (2 explanations)
      const paris = await addCity(SYSTEM_USER, { name: 'Paris' });
      const parisLocatedToFrance = await createRelation(SYSTEM_USER, {
        fromId: paris.id,
        toId: FRANCE,
        start_time: '2020-01-20T20:30:00.000Z',
        stop_time: '2020-02-29T10:00:00.000Z',
        confidence: 100,
        relationship_type: RELATION_LOCATED_AT,
        objectMarking: [TLP_WHITE_ID],
      });
      await wait(TEN_SECONDS); // let some time to rule manager to create the elements
      // Check the inferences
      const afterLiveRelations = await getInferences(RELATION_LOCATED_AT);
      expect(afterLiveRelations.length).toBe(5);
      // Inferences must have been created by the markings combination
      const parisToWesternEurope = await inferenceLookup(afterLiveRelations, PARIS, WESTERN_EUROPE, RELATION_LOCATED_AT);
      expect(parisToWesternEurope).not.toBeNull();
      expect(parisToWesternEurope.confidence).toBe(58); // AVG 2 relations (100 + 0) = 50
      expect(parisToWesternEurope.start_time).toBe('2020-01-20T20:30:00.000Z');
      expect(parisToWesternEurope.stop_time).toBe('2020-02-29T10:00:00.000Z');
      const parisToWesternEuropeMarkings = parisToWesternEurope[RELATION_OBJECT_MARKING];
      expect(parisToWesternEuropeMarkings.length).toBe(2); // TLP:TEST + TLP:WHITE
      expect(parisToWesternEuropeMarkings.includes(TLP_WHITE_INSTANCE.internal_id)).toBeTruthy();
      expect(parisToWesternEuropeMarkings.includes(TLP_TEST_INSTANCE.internal_id)).toBeTruthy();
      const parisToEurope = await inferenceLookup(afterLiveRelations, PARIS, EUROPE, RELATION_LOCATED_AT);
      expect(parisToEurope).not.toBeNull();
      expect(parisToEurope.confidence).toBe(48);
      expect(parisToEurope[RULE].length).toBe(2);
      const parisToEuropeMarkings = parisToEurope[RELATION_OBJECT_MARKING];
      expect(parisToEuropeMarkings.length).toBe(2); // TLP:TEST + TLP:WHITE
      expect(parisToEuropeMarkings.includes(TLP_WHITE_INSTANCE.internal_id)).toBeTruthy();
      expect(parisToEuropeMarkings.includes(TLP_TEST_INSTANCE.internal_id)).toBeTruthy();
      // Remove the relation must remove the inferences
      await internalDeleteElementById(SYSTEM_USER, parisLocatedToFrance.internal_id);
      await wait(TEN_SECONDS); // let some time to rule manager to delete the elements
      const afterRelDeletionRelations = await getInferences(RELATION_LOCATED_AT);
      expect(afterRelDeletionRelations.length).toBe(3);
      // Recreate the relation
      await createRelation(SYSTEM_USER, { fromId: paris.id, toId: FRANCE, relationship_type: RELATION_LOCATED_AT });
      await wait(TEN_SECONDS); // let some time to rule manager to create the elements
      const afterRecreationRelations = await getInferences(RELATION_LOCATED_AT);
      expect(afterRecreationRelations.length).toBe(5);
      // Remove the city
      await internalDeleteElementById(SYSTEM_USER, paris.internal_id);
      await wait(TEN_SECONDS); // let some time to rule manager to delete the elements
      const afterParisDeletionRelations = await getInferences(RELATION_LOCATED_AT);
      expect(afterParisDeletionRelations.length).toBe(3);
      // Disable the rule
      await disableRule(LocatedAtLocatedRule.id);
      // Check the number of inferences
      const afterDisableRelations = await getInferences(RELATION_LOCATED_AT);
      expect(afterDisableRelations.length).toBe(0);
      // Stop modules
      await shutdownModules();
    },
    FIVE_MINUTES
  );
});
