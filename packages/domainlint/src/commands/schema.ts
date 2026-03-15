import { Command, Flags } from '@oclif/core';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { configFileSchema } from '../config/types.js';

export default class Schema extends Command {
  static override description =
    'Print the JSON schema for domainlint.json to stdout';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> > domainlint.schema.json',
  ];

  static override flags = {
    indent: Flags.integer({
      description: 'JSON indentation spaces',
      default: 2,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Schema);

    const schema = zodToJsonSchema(configFileSchema, {
      name: 'DomainlintConfig',
      $refStrategy: 'none',
    });

    this.log(JSON.stringify(schema, null, flags.indent));
  }
}
