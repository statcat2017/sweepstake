-- Fix 6 incorrect kickoff_at values in group stage matches.
-- D-1: Australia vs Turkiye (off-by-one-day, midnight ET)
-- E-0/E-4: Germany vs Ecuador / Germany vs Curacao (swapped matchdays)
-- E-1/E-5: Ivory Coast vs Curacao / Ecuador vs Ivory Coast (swapped matchdays)
-- F-5: Japan vs Tunisia (off-by-one-day, midnight ET)

UPDATE matches SET kickoff_at = '2026-06-12T21:00:00-07:00'
  WHERE stage = 'group' AND group_letter = 'D'
  AND home_team_id = (SELECT id FROM teams WHERE name = 'Australia')
  AND away_team_id = (SELECT id FROM teams WHERE name = 'Turkiye');

UPDATE matches SET kickoff_at = '2026-06-25T16:00:00-04:00'
  WHERE stage = 'group' AND group_letter = 'E'
  AND home_team_id = (SELECT id FROM teams WHERE name = 'Germany')
  AND away_team_id = (SELECT id FROM teams WHERE name = 'Ecuador');

UPDATE matches SET kickoff_at = '2026-06-25T16:00:00-04:00'
  WHERE stage = 'group' AND group_letter = 'E'
  AND home_team_id = (SELECT id FROM teams WHERE name = 'Ivory Coast')
  AND away_team_id = (SELECT id FROM teams WHERE name = 'Curacao');

UPDATE matches SET kickoff_at = '2026-06-14T12:00:00-05:00'
  WHERE stage = 'group' AND group_letter = 'E'
  AND home_team_id = (SELECT id FROM teams WHERE name = 'Germany')
  AND away_team_id = (SELECT id FROM teams WHERE name = 'Curacao');

UPDATE matches SET kickoff_at = '2026-06-14T19:00:00-04:00'
  WHERE stage = 'group' AND group_letter = 'E'
  AND home_team_id = (SELECT id FROM teams WHERE name = 'Ecuador')
  AND away_team_id = (SELECT id FROM teams WHERE name = 'Ivory Coast');

UPDATE matches SET kickoff_at = '2026-06-19T22:00:00-06:00'
  WHERE stage = 'group' AND group_letter = 'F'
  AND home_team_id = (SELECT id FROM teams WHERE name = 'Japan')
  AND away_team_id = (SELECT id FROM teams WHERE name = 'Tunisia');
