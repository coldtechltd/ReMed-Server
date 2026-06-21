import { IsString, IsOptional, IsNumber, IsDateString, IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProfileDto {
  @ApiProperty({ description: 'Full name of the user', example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({ description: 'Date of birth', example: '1990-01-01', required: false })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiProperty({ description: 'Blood group', example: 'O+', required: false })
  @IsOptional()
  @IsString()
  bloodGroup?: string;

  @ApiProperty({ description: 'Genotype', example: 'AA', required: false })
  @IsOptional()
  @IsString()
  genotype?: string;

  @ApiProperty({ description: 'Height in cm', example: 175, required: false })
  @IsOptional()
  @IsNumber()
  height?: number | null;

  @ApiProperty({ description: 'Weight in kg', example: 70, required: false })
  @IsOptional()
  @IsNumber()
  weight?: number | null;

  @ApiProperty({ description: 'Gender', example: 'Male', required: false })
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiProperty({ description: 'Country ID', example: 'd3b07384-d9a3-4b6a-8b1e-2f3b4c5d6e7f' })
  @IsUUID()
  @IsNotEmpty()
  countryId: string;

  @ApiProperty({ description: 'Phone number', example: '+1234567890' })
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @ApiProperty({ description: 'Any diagnosed conditions', example: 'Hypertension', required: false })
  @IsOptional()
  @IsString()
  diagnosedWith?: string;
}
