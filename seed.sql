-- World Cup 2026 teams (48 teams, 12 groups of 4) — real draw results
-- FIFA rankings as of 1 April 2026
INSERT OR IGNORE INTO teams (id, name, group_letter, flag_emoji, fifa_rank) VALUES
-- Group A
(1,  'Mexico', 'A', '🇲🇽', 15),
(2,  'South Korea', 'A', '🇰🇷', 25),
(3,  'South Africa', 'A', '🇿🇦', 59),
(4,  'Czechia', 'A', '🇨🇿', 38),
-- Group B
(5,  'Canada', 'B', '🇨🇦', 30),
(6,  'Switzerland', 'B', '🇨🇭', 19),
(7,  'Qatar', 'B', '🇶🇦', 55),
(8,  'Bosnia-Herzegovina', 'B', '🇧🇦', 63),
-- Group C
(9,  'Brazil', 'C', '🇧🇷', 6),
(10, 'Morocco', 'C', '🇲🇦', 8),
(11, 'Scotland', 'C', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 43),
(12, 'Haiti', 'C', '🇭🇹', 83),
-- Group D
(13, 'USA', 'D', '🇺🇸', 16),
(14, 'Paraguay', 'D', '🇵🇾', 41),
(15, 'Australia', 'D', '🇦🇺', 27),
(16, 'Turkiye', 'D', '🇹🇷', 22),
-- Group E
(17, 'Germany', 'E', '🇩🇪', 10),
(18, 'Ecuador', 'E', '🇪🇨', 23),
(19, 'Ivory Coast', 'E', '🇨🇮', 34),
(20, 'Curacao', 'E', '🇨🇼', 82),
-- Group F
(21, 'Netherlands', 'F', '🇳🇱', 7),
(22, 'Japan', 'F', '🇯🇵', 18),
(23, 'Tunisia', 'F', '🇹🇳', 44),
(24, 'Sweden', 'F', '🇸🇪', 37),
-- Group G
(25, 'Belgium', 'G', '🇧🇪', 9),
(26, 'Iran', 'G', '🇮🇷', 20),
(27, 'Egypt', 'G', '🇪🇬', 29),
(28, 'New Zealand', 'G', '🇳🇿', 85),
-- Group H
(29, 'Spain', 'H', '🇪🇸', 2),
(30, 'Uruguay', 'H', '🇺🇾', 17),
(31, 'Saudi Arabia', 'H', '🇸🇦', 61),
(32, 'Cape Verde', 'H', '🇨🇻', 68),
-- Group I
(33, 'France', 'I', '🇫🇷', 1),
(34, 'Senegal', 'I', '🇸🇳', 13),
(35, 'Norway', 'I', '🇳🇴', 31),
(36, 'Iraq', 'I', '🇮🇶', 57),
-- Group J
(37, 'Argentina', 'J', '🇦🇷', 3),
(38, 'Austria', 'J', '🇦🇹', 24),
(39, 'Algeria', 'J', '🇩🇿', 28),
(40, 'Jordan', 'J', '🇯🇴', 64),
-- Group K
(41, 'Portugal', 'K', '🇵🇹', 5),
(42, 'Colombia', 'K', '🇨🇴', 12),
(43, 'Uzbekistan', 'K', '🇺🇿', 49),
(44, 'DR Congo', 'K', '🇨🇩', 46),
-- Group L
(45, 'England', 'L', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 4),
(46, 'Croatia', 'L', '🇭🇷', 11),
(47, 'Panama', 'L', '🇵🇦', 33),
(48, 'Ghana', 'L', '🇬🇭', 73);
