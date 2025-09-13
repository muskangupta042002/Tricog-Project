import React from 'react';
import { Typography, Link as MuiLink, Box, Stack } from '@mui/material';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';

function ContactInfo() {
  return (
    <Box>
      {/* Contact Us Heading */}
      <Typography 
        variant="h6" 
        gutterBottom 
        sx={{ color: '#E3F2FD', fontWeight: 1000 }}
      >
        Contact Us
      </Typography>

      {/* Address */}
      <Stack direction="row" alignItems="flex-start" spacing={1} sx={{ mb: 1 }}>
        <LocationOnIcon sx={{ color: '#314e66ff' }} />
        <Typography variant="body2" sx={{ color: '#372923ff', lineHeight: 1.6 }}>
          <strong style={{ color: '#e02a2aff' }}>Tricog Health India Private Limited</strong><br />
          India<br />
          Old No 82, New No 3 PID No 5-24-3<br />
          2nd Main Road, Vyalikaval Extension<br />
          Bengaluru, Karnataka, 560003
        </Typography>
      </Stack>

      {/* Email */}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <EmailIcon sx={{ color: '#314e66ff' }} />
        <MuiLink href="mailto:sales@tricog.com" variant="body2" sx={{ color: '#314e66ff' }}>
          sales@tricog.com
        </MuiLink>
      </Stack>

      {/* Phone */}
      <Stack direction="row" alignItems="center" spacing={1}>
        <PhoneIcon sx={{ color: '#314e66ff' }} />
        <Typography variant="body2" sx={{ color: '#314e66ff' }}>
          +91-080-4718-9181
        </Typography>
      </Stack>
    </Box>
  );
}

export default ContactInfo;
