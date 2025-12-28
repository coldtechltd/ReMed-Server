import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { countries } from '../schema';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const db = drizzle(pool);

const countryData = [
  { name: 'Afghanistan', code: 'AF', callCode: '+93' },
  { name: 'Albania', code: 'AL', callCode: '+355' },
  { name: 'Algeria', code: 'DZ', callCode: '+213' },
  { name: 'American Samoa', code: 'AS', callCode: '+1-684' },
  { name: 'Andorra', code: 'AD', callCode: '+376' },
  { name: 'Angola', code: 'AO', callCode: '+244' },
  { name: 'Anguilla', code: 'AI', callCode: '+1-264' },
  { name: 'Antarctica', code: 'AQ', callCode: '+672' },
  { name: 'Antigua and Barbuda', code: 'AG', callCode: '+1-268' },
  { name: 'Argentina', code: 'AR', callCode: '+54' },
  { name: 'Armenia', code: 'AM', callCode: '+374' },
  { name: 'Aruba', code: 'AW', callCode: '+297' },
  { name: 'Australia', code: 'AU', callCode: '+61' },
  { name: 'Austria', code: 'AT', callCode: '+43' },
  { name: 'Azerbaijan', code: 'AZ', callCode: '+994' },

  { name: 'Bahamas', code: 'BS', callCode: '+1-242' },
  { name: 'Bahrain', code: 'BH', callCode: '+973' },
  { name: 'Bangladesh', code: 'BD', callCode: '+880' },
  { name: 'Barbados', code: 'BB', callCode: '+1-246' },
  { name: 'Belarus', code: 'BY', callCode: '+375' },
  { name: 'Belgium', code: 'BE', callCode: '+32' },
  { name: 'Belize', code: 'BZ', callCode: '+501' },
  { name: 'Benin', code: 'BJ', callCode: '+229' },
  { name: 'Bermuda', code: 'BM', callCode: '+1-441' },
  { name: 'Bhutan', code: 'BT', callCode: '+975' },
  { name: 'Bolivia', code: 'BO', callCode: '+591' },
  { name: 'Bosnia and Herzegovina', code: 'BA', callCode: '+387' },
  { name: 'Botswana', code: 'BW', callCode: '+267' },
  { name: 'Brazil', code: 'BR', callCode: '+55' },
  { name: 'Brunei', code: 'BN', callCode: '+673' },
  { name: 'Bulgaria', code: 'BG', callCode: '+359' },
  { name: 'Burkina Faso', code: 'BF', callCode: '+226' },
  { name: 'Burundi', code: 'BI', callCode: '+257' },

  { name: 'Cambodia', code: 'KH', callCode: '+855' },
  { name: 'Cameroon', code: 'CM', callCode: '+237' },
  { name: 'Canada', code: 'CA', callCode: '+1' },
  { name: 'Cape Verde', code: 'CV', callCode: '+238' },
  { name: 'Cayman Islands', code: 'KY', callCode: '+1-345' },
  { name: 'Central African Republic', code: 'CF', callCode: '+236' },
  { name: 'Chad', code: 'TD', callCode: '+235' },
  { name: 'Chile', code: 'CL', callCode: '+56' },
  { name: 'China', code: 'CN', callCode: '+86' },
  { name: 'Colombia', code: 'CO', callCode: '+57' },
  { name: 'Comoros', code: 'KM', callCode: '+269' },
  { name: 'Congo (DRC)', code: 'CD', callCode: '+243' },
  { name: 'Congo (Republic)', code: 'CG', callCode: '+242' },
  { name: 'Costa Rica', code: 'CR', callCode: '+506' },
  { name: 'Croatia', code: 'HR', callCode: '+385' },
  { name: 'Cuba', code: 'CU', callCode: '+53' },
  { name: 'Cyprus', code: 'CY', callCode: '+357' },
  { name: 'Czech Republic', code: 'CZ', callCode: '+420' },

  { name: 'Denmark', code: 'DK', callCode: '+45' },
  { name: 'Djibouti', code: 'DJ', callCode: '+253' },
  { name: 'Dominica', code: 'DM', callCode: '+1-767' },
  { name: 'Dominican Republic', code: 'DO', callCode: '+1-809' },

  { name: 'Ecuador', code: 'EC', callCode: '+593' },
  { name: 'Egypt', code: 'EG', callCode: '+20' },
  { name: 'El Salvador', code: 'SV', callCode: '+503' },
  { name: 'Equatorial Guinea', code: 'GQ', callCode: '+240' },
  { name: 'Eritrea', code: 'ER', callCode: '+291' },
  { name: 'Estonia', code: 'EE', callCode: '+372' },
  { name: 'Ethiopia', code: 'ET', callCode: '+251' },

  { name: 'Fiji', code: 'FJ', callCode: '+679' },
  { name: 'Finland', code: 'FI', callCode: '+358' },
  { name: 'France', code: 'FR', callCode: '+33' },

  { name: 'Gabon', code: 'GA', callCode: '+241' },
  { name: 'Gambia', code: 'GM', callCode: '+220' },
  { name: 'Georgia', code: 'GE', callCode: '+995' },
  { name: 'Germany', code: 'DE', callCode: '+49' },
  { name: 'Ghana', code: 'GH', callCode: '+233' },
  { name: 'Greece', code: 'GR', callCode: '+30' },
  { name: 'Greenland', code: 'GL', callCode: '+299' },
  { name: 'Grenada', code: 'GD', callCode: '+1-473' },
  { name: 'Guatemala', code: 'GT', callCode: '+502' },
  { name: 'Guinea', code: 'GN', callCode: '+224' },
  { name: 'Guinea-Bissau', code: 'GW', callCode: '+245' },
  { name: 'Guyana', code: 'GY', callCode: '+592' },

  { name: 'Haiti', code: 'HT', callCode: '+509' },
  { name: 'Honduras', code: 'HN', callCode: '+504' },
  { name: 'Hungary', code: 'HU', callCode: '+36' },

  { name: 'Iceland', code: 'IS', callCode: '+354' },
  { name: 'India', code: 'IN', callCode: '+91' },
  { name: 'Indonesia', code: 'ID', callCode: '+62' },
  { name: 'Iran', code: 'IR', callCode: '+98' },
  { name: 'Iraq', code: 'IQ', callCode: '+964' },
  { name: 'Ireland', code: 'IE', callCode: '+353' },
  { name: 'Israel', code: 'IL', callCode: '+972' },
  { name: 'Italy', code: 'IT', callCode: '+39' },

  { name: 'Jamaica', code: 'JM', callCode: '+1-876' },
  { name: 'Japan', code: 'JP', callCode: '+81' },
  { name: 'Jordan', code: 'JO', callCode: '+962' },

  { name: 'Kazakhstan', code: 'KZ', callCode: '+7' },
  { name: 'Kenya', code: 'KE', callCode: '+254' },
  { name: 'Kuwait', code: 'KW', callCode: '+965' },

  { name: 'Laos', code: 'LA', callCode: '+856' },
  { name: 'Latvia', code: 'LV', callCode: '+371' },
  { name: 'Lebanon', code: 'LB', callCode: '+961' },
  { name: 'Lesotho', code: 'LS', callCode: '+266' },
  { name: 'Liberia', code: 'LR', callCode: '+231' },
  { name: 'Libya', code: 'LY', callCode: '+218' },
  { name: 'Lithuania', code: 'LT', callCode: '+370' },
  { name: 'Luxembourg', code: 'LU', callCode: '+352' },

  { name: 'Madagascar', code: 'MG', callCode: '+261' },
  { name: 'Malawi', code: 'MW', callCode: '+265' },
  { name: 'Malaysia', code: 'MY', callCode: '+60' },
  { name: 'Maldives', code: 'MV', callCode: '+960' },
  { name: 'Mali', code: 'ML', callCode: '+223' },
  { name: 'Malta', code: 'MT', callCode: '+356' },
  { name: 'Mauritania', code: 'MR', callCode: '+222' },
  { name: 'Mauritius', code: 'MU', callCode: '+230' },
  { name: 'Mexico', code: 'MX', callCode: '+52' },
  { name: 'Moldova', code: 'MD', callCode: '+373' },
  { name: 'Mongolia', code: 'MN', callCode: '+976' },
  { name: 'Montenegro', code: 'ME', callCode: '+382' },
  { name: 'Morocco', code: 'MA', callCode: '+212' },
  { name: 'Mozambique', code: 'MZ', callCode: '+258' },
  { name: 'Myanmar', code: 'MM', callCode: '+95' },

  { name: 'Namibia', code: 'NA', callCode: '+264' },
  { name: 'Nepal', code: 'NP', callCode: '+977' },
  { name: 'Netherlands', code: 'NL', callCode: '+31' },
  { name: 'New Zealand', code: 'NZ', callCode: '+64' },
  { name: 'Nicaragua', code: 'NI', callCode: '+505' },
  { name: 'Niger', code: 'NE', callCode: '+227' },
  { name: 'Nigeria', code: 'NG', callCode: '+234' },
  { name: 'North Korea', code: 'KP', callCode: '+850' },
  { name: 'Norway', code: 'NO', callCode: '+47' },

  { name: 'Oman', code: 'OM', callCode: '+968' },

  { name: 'Pakistan', code: 'PK', callCode: '+92' },
  { name: 'Panama', code: 'PA', callCode: '+507' },
  { name: 'Paraguay', code: 'PY', callCode: '+595' },
  { name: 'Peru', code: 'PE', callCode: '+51' },
  { name: 'Philippines', code: 'PH', callCode: '+63' },
  { name: 'Poland', code: 'PL', callCode: '+48' },
  { name: 'Portugal', code: 'PT', callCode: '+351' },

  { name: 'Qatar', code: 'QA', callCode: '+974' },

  { name: 'Romania', code: 'RO', callCode: '+40' },
  { name: 'Russia', code: 'RU', callCode: '+7' },
  { name: 'Rwanda', code: 'RW', callCode: '+250' },

  { name: 'Saudi Arabia', code: 'SA', callCode: '+966' },
  { name: 'Senegal', code: 'SN', callCode: '+221' },
  { name: 'Serbia', code: 'RS', callCode: '+381' },
  { name: 'Sierra Leone', code: 'SL', callCode: '+232' },
  { name: 'Singapore', code: 'SG', callCode: '+65' },
  { name: 'Slovakia', code: 'SK', callCode: '+421' },
  { name: 'Slovenia', code: 'SI', callCode: '+386' },
  { name: 'Somalia', code: 'SO', callCode: '+252' },
  { name: 'South Africa', code: 'ZA', callCode: '+27' },
  { name: 'South Korea', code: 'KR', callCode: '+82' },
  { name: 'Spain', code: 'ES', callCode: '+34' },
  { name: 'Sri Lanka', code: 'LK', callCode: '+94' },
  { name: 'Sudan', code: 'SD', callCode: '+249' },
  { name: 'Sweden', code: 'SE', callCode: '+46' },
  { name: 'Switzerland', code: 'CH', callCode: '+41' },
  { name: 'Syria', code: 'SY', callCode: '+963' },

  { name: 'Taiwan', code: 'TW', callCode: '+886' },
  { name: 'Tanzania', code: 'TZ', callCode: '+255' },
  { name: 'Thailand', code: 'TH', callCode: '+66' },
  { name: 'Togo', code: 'TG', callCode: '+228' },
  { name: 'Tunisia', code: 'TN', callCode: '+216' },
  { name: 'Turkey', code: 'TR', callCode: '+90' },

  { name: 'Uganda', code: 'UG', callCode: '+256' },
  { name: 'Ukraine', code: 'UA', callCode: '+380' },
  { name: 'United Arab Emirates', code: 'AE', callCode: '+971' },
  { name: 'United Kingdom', code: 'GB', callCode: '+44' },
  { name: 'United States', code: 'US', callCode: '+1' },
  { name: 'Uruguay', code: 'UY', callCode: '+598' },
  { name: 'Uzbekistan', code: 'UZ', callCode: '+998' },

  { name: 'Venezuela', code: 'VE', callCode: '+58' },
  { name: 'Vietnam', code: 'VN', callCode: '+84' },

  { name: 'Yemen', code: 'YE', callCode: '+967' },

  { name: 'Zambia', code: 'ZM', callCode: '+260' },
  { name: 'Zimbabwe', code: 'ZW', callCode: '+263' },
];

async function seed() {
  console.log('🌍 Seeding countries...');

  await db.insert(countries).values(countryData);

  console.log('✅ Countries seeded successfully');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seeding failed', err);
  process.exit(1);
});
